import type { ClienteConfig, ContextoConversacion, MotivoEscalamiento, TurnoEntrante } from '../types/index.js';
import { guardarMensaje, obtenerContexto, type MensajeAGuardar } from '../conversacion/almacen.js';
import { llamarLLMConReintento } from '../llm/conReintento.js';
import { construirSystemPrompt } from '../llm/prompt.js';
import { enviarMensaje } from '../salida/chatwoot.js';
import { responderYEscalar } from '../salida/escalamiento.js';
import { herramientas } from '../llm/herramientas/index.js';
import { rutear } from '../router/index.js';
import { detectarIdioma, esSoloSaludo } from '../router/texto.js';
import { aplicarReactivacion, estaPausado, guardarIdioma } from '../conversacion/estado.js';
import { esRepeticion } from './repeticion.js';
import { textoFijo } from './textosFijos.js';
import { debeAcusar } from './acuse.js';

type Mensajes = Parameters<typeof llamarLLMConReintento>[0];
type Extra = Partial<Pick<MensajeAGuardar,
  'origen' | 'modelo' | 'tokensEntrada' | 'tokensSalida' | 'latenciaMs' | 'herramientas'>>;

/** Texto fijo de saludo (configExtra.saludo, por idioma). Si no existe, responde el modelo. */
export function saludoFijo(cfg: ClienteConfig, idioma: string): string | null {
  const s = cfg.configExtra.saludo as Record<string, unknown> | null | undefined;
  const texto = s?.[idioma] ?? s?.[cfg.idiomaDefault];
  return typeof texto === 'string' && texto.trim() ? texto : null;
}

/** Memoria: huésped → user; bot y agente → assistant. Los del sistema no se muestran al modelo. */
export function armarMensajes(cfg: ClienteConfig, conv: ContextoConversacion, texto: string, esSaludo = false): Mensajes {
  const historial: Mensajes = [];
  for (const m of conv.ultimosMensajes) {
    const esHuesped = m.rol === 'huesped';
    const esBotOAgente = m.rol === 'bot' || m.rol === 'agente';
    if (esHuesped) historial.push({ rol: 'user', contenido: m.contenido });
    else if (esBotOAgente) historial.push({ rol: 'assistant', contenido: m.contenido });
  }
  const sistema = { rol: 'system' as const, contenido: construirSystemPrompt(cfg, conv, esSaludo) };
  return [sistema, ...historial, { rol: 'user', contenido: texto }];
}

export const avisarFallo = (que: string) => (e: unknown) =>
  console.error(`${que}:`, e instanceof Error ? e.message : e);

export async function enviarYGuardar(
  cfg: ClienteConfig, conv: ContextoConversacion, texto: string, extra: Extra = {},
): Promise<void> {
  const id = await enviarMensaje(cfg, conv.chatwootConversationId, texto);
  // Si guardar falla, el huésped ya recibió su respuesta: solo se registra.
  await guardarMensaje(cfg, {
    conversacionId: conv.id, chatwootMessageId: id, rol: 'bot', contenido: texto, ...extra,
  }).catch(avisarFallo('NO SE GUARDÓ el mensaje del bot'));
}

export async function escalarYGuardar(
  cfg: ClienteConfig, conv: ContextoConversacion, pregunta: string, motivo: MotivoEscalamiento,
): Promise<void> {
  const r = await responderYEscalar(cfg, conv.chatwootConversationId, conv.idioma, pregunta, motivo);
  await guardarMensaje(cfg, {
    conversacionId: conv.id, chatwootMessageId: r.mensajeId, rol: 'bot',
    contenido: r.texto, origen: 'escalamiento',
  }).catch(avisarFallo('NO SE GUARDÓ el mensaje de escalamiento'));
}

/**
 * Carga la conversación ANTES de guardar lo nuevo, aplica la reactivación, guarda lo que escribió
 * el huésped y consulta al router. Devuelve null si el bot no debe responder.
 */
async function prepararTurno(
  cfg: ClienteConfig, turno: TurnoEntrante,
): Promise<ContextoConversacion | null> {
  const primero = turno.mensajes[0];
  if (!primero) return null;
  const datos = {
    conversationId: turno.chatwootConversationId, contactId: primero.chatwootContactId || null,
    telefono: primero.telefono, canal: primero.canal,
  };
  let conv = await aplicarReactivacion(cfg, await obtenerContexto(cfg, datos));
  for (const m of turno.mensajes) {
    await guardarMensaje(cfg, {
      conversacionId: conv.id, chatwootMessageId: m.chatwootMessageId || null, rol: 'huesped',
      contenido: m.contenido, tipo: m.tipo,
    }).catch(avisarFallo('NO SE GUARDÓ el mensaje del huésped'));
  }
  const decision = await rutear(turno, conv, cfg);
  if (decision.tipo !== 'llm') {
    // Hoy solo existe la regla "pausado". "escalar" y "formulario" llegarán con las reglas que faltan.
    const detalle = decision.tipo === 'ignorar' ? decision.motivo : decision.tipo;
    console.log(`SIN RESPUESTA conv=${conv.chatwootConversationId} motivo=${detalle}`);
    if (decision.tipo === 'ignorar' && decision.motivo === 'bot_pausado') await acusarSiCorresponde(cfg, conv, turno);
    return null;
  }
  const idioma = detectarIdioma(turno.textoAgrupado, conv.idioma, cfg.idiomas);
  if (idioma !== conv.idioma) {
    const alerta = avisarFallo('NO SE GUARDÓ el idioma');
    await guardarIdioma(cfg, conv.chatwootConversationId, idioma).catch(alerta);
    conv = { ...conv, idioma };
  }
  return conv;
}

/** Atiende un turno completo: memoria, router, saludo, modelo y envío. Va dentro del candado. */
export async function atenderTurno(cfg: ClienteConfig, turno: TurnoEntrante): Promise<void> {
  const conv = await prepararTurno(cfg, turno);
  if (!conv) return;
  const texto = turno.textoAgrupado;
  const saludo = esSoloSaludo(texto) ? saludoFijo(cfg, conv.idioma) : null;
  const resp = saludo ? null : await responderConModelo(cfg, conv, texto, esSoloSaludo(texto));
  // Justo antes de enviar: si una persona tomó la conversación mientras tanto, no se le pisa.
  if (await estaPausado(conv.id)) {
    console.log(`NO SE ENVÍA conv=${conv.chatwootConversationId} motivo=una persona tomó la conversación`);
    return;
  }
  if (saludo) return enviarYGuardar(cfg, conv, saludo, { origen: 'saludo' });
  if (!resp) return escalarYGuardar(cfg, conv, texto, 'error_interno');
  if (resp.noSeElDato) return escalarYGuardar(cfg, conv, texto, 'no_se_el_dato');
  if (!resp.texto) return;
  if (esRepeticion(conv, resp.texto, texto)) {
    console.log(`REPETICIÓN EVITADA conv=${conv.chatwootConversationId}`);
    return enviarYGuardar(cfg, conv, textoFijo(cfg, 'mensajeNoEntendi', conv.idioma), { origen: 'no_entendi' });
  }
  await enviarYGuardar(cfg, conv, resp.texto, {
    origen: 'llm', modelo: resp.modelo, tokensEntrada: resp.tokensEntrada,
    tokensSalida: resp.tokensSalida, latenciaMs: resp.latenciaMs, herramientas: resp.herramientasUsadas,
  });
}

type Resp = Awaited<ReturnType<typeof llamarLLMConReintento>>;

/** Pide la respuesta al modelo. Devuelve null si falló del todo (ya se reintentó). */
async function responderConModelo(
  cfg: ClienteConfig, conv: ContextoConversacion, texto: string, esSaludo: boolean,
): Promise<Resp | null> {
  try {
    const r = await llamarLLMConReintento(
      armarMensajes(cfg, conv, texto, esSaludo), herramientas, { cfg, conv },
      { forzarHerramienta: !esSoloSaludo(texto) },
    );
    const h = r.herramientasUsadas.join(',');
    console.log(`LLM ${r.modelo} ${r.latenciaMs}ms tokens ${r.tokensEntrada}/${r.tokensSalida} herramientas=[${h}] noSe=${r.noSeElDato}`);
    return r;
  } catch (e) {
    console.error('LLM FALLÓ DEL TODO:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    return null;
  }
}

/** Bot pausado: avisa al huésped UNA vez por pausa. Si falla, solo se registra (nunca dispara otro escalamiento). */
async function acusarSiCorresponde(cfg: ClienteConfig, conv: ContextoConversacion, turno: TurnoEntrante): Promise<void> {
  try {
    if (!(await debeAcusar(conv.id))) return;
    const idioma = detectarIdioma(turno.textoAgrupado, conv.idioma, cfg.idiomas);
    await enviarYGuardar(cfg, { ...conv, idioma }, textoFijo(cfg, 'mensajeAcuse', idioma), { origen: 'acuse' });
  } catch (e) {
    avisarFallo('NO SE PUDO AVISAR AL HUÉSPED (pausa)')(e);
  }
}
