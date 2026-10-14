import type { ClienteConfig, ContextoConversacion, MotivoEscalamiento, TipoMensaje, TurnoEntrante } from '../types/index.js';
import { guardarMensaje, obtenerContexto, type MensajeAGuardar } from '../conversacion/almacen.js';
import { llamarLLMConReintento } from '../llm/conReintento.js';
import { construirSystemPrompt } from '../llm/prompt.js';
import { enviarMensaje, enviarNotaPrivada } from '../salida/chatwoot.js';
import { avisarAlCelular } from '../salida/avisoEquipo.js';
import { alertarEnvioIncierto, responderYEscalar, avisarEquipoYPausar } from '../salida/escalamiento.js';
import { avisoPorRedDeSeguridad, motivoParaAvisarAlEquipo } from './avisoDeEquipo.js';
import { EnvioIncierto } from '../salida/errores.js';
import { herramientas } from '../llm/herramientas/index.js';
import { rutear } from '../router/index.js';
import { detectarIdioma, esSoloSaludo } from '../router/texto.js';
import { aplicarReactivacion, estaPausado, guardarIdioma } from '../conversacion/estado.js';
import { llegoAlTope } from '../conversacion/topeDiario.js';
import { esRepeticion } from './repeticion.js';
import { textoFijo } from './textosFijos.js';
import { debeAcusar } from './acuse.js';
import { debeAvisarMedia, descripcionMedia } from './avisoMedia.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';

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
    // Se enmascara también el historial: hay mensajes guardados antes de que existiera el enmascarado de entrada.
    if (esHuesped) historial.push({ rol: 'user', contenido: enmascararSensibles(m.contenido) });
    else if (esBotOAgente) historial.push({ rol: 'assistant', contenido: enmascararSensibles(m.contenido) });
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
): Promise<boolean> {
  const r = await responderYEscalar(cfg, conv.chatwootConversationId, conv.idioma, pregunta, motivo);
  if (r.mensajeId === null) return r.avisado; // el aviso al huésped no salió: no hay mensaje que guardar
  await guardarMensaje(cfg, {
    conversacionId: conv.id, chatwootMessageId: r.mensajeId, rol: 'bot',
    contenido: r.texto, origen: 'escalamiento',
  }).catch(avisarFallo('NO SE GUARDÓ el mensaje de escalamiento'));
  return r.avisado;
}

type Preparado = { conv: ContextoConversacion; temaAltoValor: MotivoEscalamiento | null };
/** prepararTurno terminó el turno por su cuenta (no hay nada más que hacer): ¿quedó atendido? */
type TurnoTerminado = { terminado: ResultadoTurno };

/**
 * Cómo terminó un turno. `atendido: false` = nadie le respondió al huésped ni se avisó al equipo de forma confirmada:
 * su mensaje queda sin `atendido_at` y el barrido de la bandeja (bandeja.ts) lo retoma.
 */
export type ResultadoTurno = { atendido: boolean };
const ATENDIDO: ResultadoTurno = { atendido: true };

/**
 * Carga la conversación ANTES de guardar lo nuevo, aplica la reactivación, guarda lo que escribió
 * el huésped y consulta al router. Devuelve null si el bot no debe responder nada.
 * Si el router dice "escalar" (tema de alto valor), el turno SIGUE: el modelo responde con la
 * info real y, después de enviarla, se avisa al equipo y se pausa (ver atenderTurno).
 */
async function prepararTurno(cfg: ClienteConfig, turno: TurnoEntrante): Promise<Preparado | TurnoTerminado> {
  const primero = turno.mensajes[0];
  if (!primero) return { terminado: ATENDIDO };
  const datos = {
    conversationId: turno.chatwootConversationId, contactId: primero.chatwootContactId || null,
    telefono: primero.telefono, canal: primero.canal,
  };
  // Los mensajes de este turno ya se guardaron al llegar (bandeja durable): no van al historial del modelo.
  const idsDelTurno = turno.mensajes.map((m) => m.chatwootMessageId).filter((id) => id > 0);
  let conv = await aplicarReactivacion(cfg, await obtenerContexto(cfg, datos, idsDelTurno));
  for (const m of turno.mensajes) {
    await guardarMensaje(cfg, {
      conversacionId: conv.id, chatwootMessageId: m.chatwootMessageId || null, rol: 'huesped',
      contenido: m.contenido || `[${m.tipo}]`, tipo: m.tipo,
      // Sin id de Chatwoot no hay forma de marcarlo después: nace atendido para que el barrido no lo rehaga.
      ...(m.chatwootMessageId ? {} : { atendidoAt: new Date().toISOString() }),
    }).catch(avisarFallo('NO SE GUARDÓ el mensaje del huésped'));
  }
  const decision = await rutear(turno, conv, cfg);
  if (decision.tipo === 'ignorar' || decision.tipo === 'formulario') {
    const detalle = decision.tipo === 'ignorar' ? decision.motivo : decision.tipo;
    console.log(`SIN RESPUESTA conv=${conv.chatwootConversationId} motivo=${detalle}`);
    if (decision.tipo === 'ignorar' && decision.motivo === 'bot_pausado') await acusarSiCorresponde(cfg, conv, turno);
    return { terminado: ATENDIDO };
  }
  if (decision.tipo === 'media') {
    await atenderMedia(cfg, conv, decision.tipos);
    return { terminado: ATENDIDO };
  }
  const idioma = detectarIdioma(turno.textoAgrupado, conv.idioma, cfg.idiomas);
  if (idioma !== conv.idioma) {
    const alerta = avisarFallo('NO SE GUARDÓ el idioma');
    await guardarIdioma(cfg, conv.chatwootConversationId, idioma).catch(alerta);
    conv = { ...conv, idioma };
  }
  if (decision.tipo === 'escalar' && decision.motivo === 'pidio_humano') {
    return { terminado: { atendido: await escalarYGuardar(cfg, conv, turno.textoAgrupado, 'pidio_humano') } };
  }
  // Tope diario de mensajes del bot en esta conversación: no se gasta modelo, pasa al equipo y se pausa.
  if (await llegoAlTope(cfg, conv.id)) {
    console.log(`TOPE DIARIO conv=${conv.chatwootConversationId} limite=${cfg.limiteMensajesDiaConversacion}`);
    return { terminado: { atendido: await escalarYGuardar(cfg, conv, turno.textoAgrupado, 'limite_mensajes') } };
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
export async function atenderTurno(cfg: ClienteConfig, turno: TurnoEntrante): Promise<ResultadoTurno> {
  const preparado = await prepararTurno(cfg, turno);
  if ('terminado' in preparado) return preparado.terminado;
  const { conv, temaAltoValor } = preparado;
  const texto = turno.textoAgrupado;
  const saludo = esSoloSaludo(texto) ? saludoFijo(cfg, conv.idioma) : null;
  const resp = saludo ? null : await responderConModelo(cfg, conv, texto, esSoloSaludo(texto));
  // Justo antes de enviar: si una persona tomó la conversación mientras tanto, no se le pisa.
  if (await estaPausado(cfg, conv.id)) {
    console.log(`NO SE ENVÍA conv=${conv.chatwootConversationId} motivo=una persona tomó la conversación`);
    return ATENDIDO;
  }
  if (saludo) {
    await enviarYGuardar(cfg, conv, saludo, { origen: 'saludo' });
    await avisarSiTemaAltoValor(cfg, conv, texto, temaAltoValor);
    return ATENDIDO;
  }
  // Si falló del todo o el modelo no sabía el dato: ya escala con su propio motivo. No se duplica el aviso.
  if (!resp) return { atendido: await escalarYGuardar(cfg, conv, texto, 'error_interno') };
  if (resp.noSeElDato) return { atendido: await escalarYGuardar(cfg, conv, texto, 'no_se_el_dato') };
  if (!resp.texto) return ATENDIDO;
  if (esRepeticion(conv, resp.texto, texto)) {
    console.log(`REPETICIÓN EVITADA conv=${conv.chatwootConversationId}`);
    await enviarYGuardar(cfg, conv, textoFijo(cfg, 'mensajeNoEntendi', conv.idioma), { origen: 'no_entendi' });
    await avisarSiTemaAltoValor(cfg, conv, texto, motivoParaAvisarAlEquipo(temaAltoValor, resp.herramientasUsadas));
    return ATENDIDO;
  }
  await enviarYGuardar(cfg, conv, resp.texto, {
    origen: 'llm', modelo: resp.modelo, tokensEntrada: resp.tokensEntrada,
    tokensSalida: resp.tokensSalida, latenciaMs: resp.latenciaMs, herramientas: resp.herramientasUsadas,
  });
  // Tema de alto valor (router), el modelo pidió a una persona (herramienta pasar_a_persona) o el texto que salió promete
  // que una persona responderá (red de seguridad): se avisa al equipo y se pausa.
  // Huella para el piloto: así se mide cuántas veces actúa la red y se repasan las falsas alarmas.
  if (avisoPorRedDeSeguridad(temaAltoValor, resp.herramientasUsadas, resp.texto)) {
    console.log(`RED DE SEGURIDAD conv=${conv.chatwootConversationId} promesa="${enmascararSensibles(resp.texto).replace(/\s+/g, ' ').slice(0, 200)}"`);
  }
  await avisarSiTemaAltoValor(cfg, conv, texto, motivoParaAvisarAlEquipo(temaAltoValor, resp.herramientasUsadas, resp.texto));
  return ATENDIDO;
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

/**
 * El huésped mandó solo audio, imagen, ubicación u otro archivo (sin texto). El bot no los puede leer:
 * pide que escriba (un aviso cada 10 min por conversación) y deja una nota privada al equipo (siempre).
 * NO pausa el bot. Un fallo aquí se registra y nunca dispara otro escalamiento.
 */
async function atenderMedia(cfg: ClienteConfig, conv: ContextoConversacion, tipos: TipoMensaje[]): Promise<void> {
  console.log(`MEDIA conv=${conv.chatwootConversationId} tipos=${tipos.join(',')}`);
  let avisado = false;
  try {
    if (await debeAvisarMedia(conv.id)) {
      await enviarYGuardar(cfg, conv, textoFijo(cfg, 'mensajeMedia', conv.idioma), { origen: 'media' });
      avisado = true;
    }
  } catch (e) {
    avisarFallo('NO SE PUDO PEDIRLE AL HUÉSPED QUE ESCRIBA (media)')(e);
  }
  const estado = avisado
    ? 'El bot le pidió que lo escriba.'
    : 'El bot no le pidió que lo escriba esta vez (ya lo había hecho hace poco o el aviso no salió).';
  const nota = `📎 El huésped envió ${descripcionMedia(tipos)} (sin texto). ${estado} Revisa la conversación por si hace falta responderle.`;
  await enviarNotaPrivada(cfg, conv.chatwootConversationId, nota)
    .catch(avisarFallo('NO SE PUDO DEJAR LA NOTA AL EQUIPO (media)'));
  await avisarAlCelular(cfg, conv.chatwootConversationId, nota);
}

/** Bot pausado: avisa al huésped UNA vez por pausa. Si falla, solo se registra (nunca dispara otro escalamiento). */
async function acusarSiCorresponde(cfg: ClienteConfig, conv: ContextoConversacion, turno: TurnoEntrante): Promise<void> {
  try {
    if (!(await debeAcusar(cfg, conv.id))) return;
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
export async function manejarFalloDeTurno(cfg: ClienteConfig, turno: TurnoEntrante, causa?: unknown): Promise<ResultadoTurno> {
  const primero = turno.mensajes[0];
  const conversationId = turno.chatwootConversationId;
  if (causa instanceof EnvioIncierto) {
    // La respuesta pudo haber salido: mandar además "te paso con el equipo" duplicaría al huésped.
    const avisado = await alertarEnvioIncierto(cfg, conversationId, turno.textoAgrupado)
      .catch((e) => { avisarFallo('ALERTA DE ENVÍO INCIERTO FALLÓ')(e); return false; });
    return { atendido: avisado };
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
        contenido: m.contenido || `[${m.tipo}]`, tipo: m.tipo,
      }).catch(avisarFallo('NO SE GUARDÓ el mensaje del huésped (recuperando turno fallido)'));
    }
    return { atendido: await escalarYGuardar(cfg, conv, turno.textoAgrupado, 'error_interno') };
  } catch (e) {
    avisarFallo('NO SE PUDO RECUPERAR EL TURNO, se escala sin guardar historial')(e);
    const r = await responderYEscalar(cfg, conversationId, cfg.idiomaDefault, turno.textoAgrupado, 'error_interno')
      .catch((e2) => { avisarFallo('ESCALAMIENTO POR ERROR FALLÓ')(e2); return null; });
    return { atendido: r?.avisado === true };
  }
}
