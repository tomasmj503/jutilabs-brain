import type { ClienteConfig, ContextoConversacion, MotivoEscalamiento, TurnoEntrante } from '../types/index.js';
import { guardarMensaje, obtenerContexto, type MensajeAGuardar } from '../conversacion/almacen.js';
import { llamarLLMConReintento } from '../llm/conReintento.js';
import { construirSystemPrompt } from '../llm/prompt.js';
import { enviarMensaje } from '../salida/chatwoot.js';
import { alertarEnvioIncierto, responderYEscalar, avisarEquipoYPausar } from '../salida/escalamiento.js';
import { EnvioIncierto } from '../salida/errores.js';
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

export function saludoFijo(cfg: ClienteConfig, idioma: string): string | null {
  const s = cfg.configExtra.saludo as Record<string, unknown> | null | undefined;
  const texto = s?.[idioma] ?? s?.[cfg.idiomaDefault];
  return typeof texto === 'string' && texto.trim() ? texto : null;
}

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
  await guardarMensaje(cfg, {
    conversacionId: conv.id, chatwootMessageId: id, rol: 'bot', contenido: texto, ...extra,
  }).catch(avisarFallo('NO SE GUARDÓ el mensaje del bot'));
}

export async function escalarYGuardar(
  cfg: ClienteConfig, conv: ContextoConversacion, pregunta: string, motivo: MotivoEscalamiento,
): Promise<void> {
  const r = await responderYEscalar(cfg, conv.chatwootConversationId, conv.idioma, pregunta, motivo);
  if (r.mensajeId === null) return; // el aviso al huésped no salió: no hay mensaje que guardar
  await guardarMensaje(cfg, {
    conversacionId: conv.id, chatwootMessageId: r.mensajeId, rol: 'bot',
    contenido: r.texto, origen: 'escalamiento',
  }).catch(avisarFallo('NO SE GUARDÓ el mensaje de escalamiento'));
}

type Preparado = { conv: ContextoConversacion; temaAltoValor: MotivoEscalamiento | null };

/**
 * Carga la conversación ANTES de guardar lo nuevo, aplica la reactivación, guarda lo que escribió
 * el huésped y consulta al router. Devuelve null si el bot no debe responder nada.
 * Si el router dice "escalar" (tema de alto valor), el turno SIGUE: el modelo responde con la
 * info real y, después de enviarla, se avisa al equipo y se pausa (ver atenderTurno).
 */
async function prepararTurno(cfg: ClienteConfig, turno: TurnoEntrante): Promise<Preparado | null> {
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
  if (decision.tipo === 'ignorar' || decision.tipo === 'formulario') {
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
  const temaAltoValor = decision.tipo === 'escalar' ? decision.motivo : null;
  return { conv, temaAltoValor };
}

/** Avisa al equipo y pausa el bot DESPUÉS de que la respuesta ya salió (un solo mensaje al huésped). */
async function avisarSiTemaAltoValor(
  cfg: ClienteConfig, conv: ContextoConversacion, texto: string, temaAltoValor: MotivoEscalamiento | null,
): Promise<void> {
  if (!temaAltoValor) return;
  await avisarEquipoYPausar(cfg, conv.chatwootConversationId, temaAltoValor, texto)
    .catch(avisarFallo('NO SE PUDO AVISAR AL EQUIPO (tema de alto valor)'));
}

/** Atiende un turno completo: memoria, router, saludo, modelo y envío. Va dentro del candado. */
export async function atenderTurno(cfg: ClienteConfig, turno: TurnoEntrante): Promise<void> {
  const preparado = await prepararTurno(cfg, turno);
  if (!preparado) return;
  const { conv, temaAltoValor } = preparado;
  const texto = turno.textoAgrupado;
  const saludo = esSoloSaludo(texto) ? saludoFijo(cfg, conv.idioma) : null;
  const resp = saludo ? null : await responderConModelo(cfg, conv, texto, esSoloSaludo(texto));
  // Justo antes de enviar: si una persona tomó la conversación mientras tanto, no se le pisa.
  if (await estaPausado(conv.id)) {
    console.log(`NO SE ENVÍA conv=${conv.chatwootConversationId} motivo=una persona tomó la conversación`);
    return;
  }
  if (saludo) {
    await enviarYGuardar(cfg, conv, saludo, { origen: 'saludo' });
    return avisarSiTemaAltoValor(cfg, conv, texto, temaAltoValor);
  }
  // Si falló del todo o el modelo no sabía el dato: ya escala con su propio motivo. No se duplica el aviso.
  if (!resp) return escalarYGuardar(cfg, conv, texto, 'error_interno');
  if (resp.noSeElDato) return escalarYGuardar(cfg, conv, texto, 'no_se_el_dato');
  if (!resp.texto) return;
  if (esRepeticion(conv, resp.texto, texto)) {
    console.log(`REPETICIÓN EVITADA conv=${conv.chatwootConversationId}`);
    await enviarYGuardar(cfg, conv, textoFijo(cfg, 'mensajeNoEntendi', conv.idioma), { origen: 'no_entendi' });
    return avisarSiTemaAltoValor(cfg, conv, texto, temaAltoValor);
  }
  await enviarYGuardar(cfg, conv, resp.texto, {
    origen: 'llm', modelo: resp.modelo, tokensEntrada: resp.tokensEntrada,
    tokensSalida: resp.tokensSalida, latenciaMs: resp.latenciaMs, herramientas: resp.herramientasUsadas,
  });
  await avisarSiTemaAltoValor(cfg, conv, texto, temaAltoValor);
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

/**
 * Si atenderTurno falla del todo (ej. Supabase caído a mitad de turno), intenta igual guardar
 * los mensajes del huésped y la respuesta antes de escalar. Si ni eso se puede, el huésped
 * igual recibe el aviso de "lo paso al equipo" (esa vez sin quedar en el historial).
 * Si la falla fue un envío que no se pudo confirmar (EnvioIncierto), no se manda nada más al huésped.
 */
export async function manejarFalloDeTurno(cfg: ClienteConfig, turno: TurnoEntrante, causa?: unknown): Promise<void> {
  const primero = turno.mensajes[0];
  const conversationId = turno.chatwootConversationId;
  if (causa instanceof EnvioIncierto) {
    // La respuesta pudo haber salido: mandar además "te paso con el equipo" duplicaría al huésped.
    await alertarEnvioIncierto(cfg, conversationId, turno.textoAgrupado)
      .catch(avisarFallo('ALERTA DE ENVÍO INCIERTO FALLÓ'));
    return;
  }
  try {
    if (!primero) throw new Error('turno sin mensajes');
    const conv = await obtenerContexto(cfg, {
      conversationId, contactId: primero.chatwootContactId || null,
      telefono: primero.telefono, canal: primero.canal,
    });
    for (const m of turno.mensajes) {
      await guardarMensaje(cfg, {
        conversacionId: conv.id, chatwootMessageId: m.chatwootMessageId || null, rol: 'huesped',
        contenido: m.contenido, tipo: m.tipo,
      }).catch(avisarFallo('NO SE GUARDÓ el mensaje del huésped (recuperando turno fallido)'));
    }
    await escalarYGuardar(cfg, conv, turno.textoAgrupado, 'error_interno');
  } catch (e) {
    avisarFallo('NO SE PUDO RECUPERAR EL TURNO, se escala sin guardar historial')(e);
    await responderYEscalar(cfg, conversationId, cfg.idiomaDefault, turno.textoAgrupado, 'error_interno')
      .catch(avisarFallo('ESCALAMIENTO POR ERROR FALLÓ'));
  }
}
