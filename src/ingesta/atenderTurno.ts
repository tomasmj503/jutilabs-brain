import type { ClienteConfig, ContextoConversacion, MotivoEscalamiento, TipoMensaje, TurnoEntrante } from '../types/index.js';
import { guardarMensaje, obtenerContexto, type MensajeAGuardar } from '../conversacion/almacen.js';
import { llamarLLMConReintento } from '../llm/conReintento.js';
import { construirSystemPrompt } from '../llm/prompt.js';
import { enviarMensaje, enviarNotaPrivada } from '../salida/chatwoot.js';
import { redis } from '../db/redis.js';
import { avisarAlCelular } from '../salida/avisoEquipo.js';
import { alertarEnvioIncierto, responderYEscalar, avisarEquipoYPausar, avisarTema, avisarRespuestaParcial, avisarFallaDePlataforma, avisarCandadoPerdido } from '../salida/escalamiento.js';
import { debeAvisarTema } from './avisoTema.js';
import type { Candado } from './lock.js';
import { esFallaDePlataforma, estadoHttp } from '../llm/fallaPlataforma.js';
import { avisoPorRedDeSeguridad, motivoParaAvisarAlEquipo } from './avisoDeEquipo.js';
import { EnvioIncierto } from '../salida/errores.js';
import { herramientas } from '../llm/herramientas/index.js';
import { rutear } from '../router/index.js';
import { detectarIdioma, esSoloSaludo } from '../router/texto.js';
import { estaPausado, guardarIdioma } from '../conversacion/estado.js';
import { llegoAlTope } from '../conversacion/topeDiario.js';
import { esRepeticion } from './repeticion.js';
import { textoFijo } from './textosFijos.js';
import { debeAcusar } from './acuse.js';
import { debeAvisarMedia, descripcionMedia } from './avisoMedia.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';
import { alertarAlEquipo } from '../salida/alertaEquipo.js';
import { registrarAvisoPendiente } from '../conversacion/avisoPendiente.js';

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

/** `tema`: tema de la lista del cliente que apareció en el mensaje (avisa al equipo, no pausa). */
type Preparado = { conv: ContextoConversacion; tema: string | null };
/** prepararTurno terminó el turno por su cuenta (no hay nada más que hacer): ¿quedó atendido? */
type TurnoTerminado = { terminado: ResultadoTurno };

/**
 * Cómo terminó un turno. `atendido: false` = nadie le respondió al huésped ni se avisó al equipo de forma confirmada:
 * su mensaje queda sin `atendido_at` y el barrido de la bandeja (bandeja.ts) lo retoma.
 */
export type ResultadoTurno = { atendido: boolean };
const ATENDIDO: ResultadoTurno = { atendido: true };

/**
 * Carga la conversación ANTES de guardar lo nuevo, guarda lo que escribió
 * el huésped y consulta al router. Devuelve null si el bot no debe responder nada.
 * Si el router detecta un tema de la lista del cliente, el turno SIGUE: el modelo responde con la
 * info real y, después de enviarla, se avisa al equipo SIN pausar (ver atenderTurno).
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
  let conv = await obtenerContexto(cfg, datos, idsDelTurno);
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
  // D-09 / #15: adjunto + texto. El router decide por el texto y el adjunto no se leería nunca: se avisa al equipo
  // (sin pausar). Ej.: «ya pagué» + la foto del comprobante.
  await avisarAdjuntoConTexto(cfg, conv, turno);
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
  const tema = decision.tipo === 'escalar' ? (decision.tema ?? String(decision.motivo)) : null;
  return { conv, tema };
}

/**
 * El turno trae texto Y adjuntos (foto, audio, documento…). El bot solo lee el texto; el equipo tiene que mirar el
 * adjunto. Nota privada + aviso al celular, sin pausar y sin escribirle al huésped. Nunca frena el turno.
 */
async function avisarAdjuntoConTexto(cfg: ClienteConfig, conv: ContextoConversacion, turno: TurnoEntrante): Promise<void> {
  const tipos = turno.mensajes.map((m) => m.tipo).filter((t) => t !== 'texto');
  if (tipos.length === 0 || turno.textoAgrupado.trim() === '') return;
  const nota = `📎 El huésped envió ${descripcionMedia(tipos)} junto con un mensaje. El bot solo lee el texto: `
    + `revisa el adjunto en la conversación (por ejemplo, un comprobante de pago).\nMensaje del huésped: "${turno.textoAgrupado.slice(0, 300)}"`;
  try {
    const alerta = await alertarAlEquipo(cfg, conv.chatwootConversationId, nota);
    if (!alerta.avisado) {
      await registrarAvisoPendiente(cfg, conv.chatwootConversationId, {
        nota, motivo: 'adjunto_con_texto', pausar: false, textoHuesped: null, idioma: conv.idioma, notaCreada: alerta.nota,
      });
    }
  } catch (e) {
    avisarFallo('NO SE PUDO AVISAR DEL ADJUNTO CON TEXTO')(e);
  }
}

/**
 * Después de que la respuesta ya salió (un solo mensaje al huésped):
 *  · si el modelo pidió a una persona (pasar_a_persona) o el texto que salió lo promete (red de seguridad): se avisa
 *    al equipo y se PAUSA (es una solicitud; el «en espera» es de la Fase 2);
 *  · si solo apareció un tema de la lista del cliente: se avisa SIN pausar, una vez por ventana (D-09 / PC-12).
 * Nunca lanza: el huésped ya tiene su respuesta.
 */
async function avisarAlFinal(
  cfg: ClienteConfig, conv: ContextoConversacion, texto: string, tema: string | null,
  herramientasUsadas: readonly string[], textoEnviado?: string, respuestaParcial = false,
): Promise<void> {
  const motivoPausa = motivoParaAvisarAlEquipo(null, herramientasUsadas, textoEnviado);
  try {
    if (motivoPausa) {
      await avisarEquipoYPausar(cfg, conv.chatwootConversationId, motivoPausa, texto);
    } else if (respuestaParcial && (await debeAvisarTema(conv.id, 'sin_dato_completo'))) {
      await avisarRespuestaParcial(cfg, conv.chatwootConversationId, texto);
    } else if (tema && (await debeAvisarTema(conv.id, tema))) {
      await avisarTema(cfg, conv.chatwootConversationId, tema, texto);
    }
  } catch (e) {
    avisarFallo('NO SE PUDO AVISAR AL EQUIPO (tema o solicitud de persona)')(e);
  }
}

/** Atiende un turno completo: memoria, router, saludo, modelo y envío. Va dentro del candado. */
export async function atenderTurno(cfg: ClienteConfig, turno: TurnoEntrante, candado?: Candado): Promise<ResultadoTurno> {
  const preparado = await prepararTurno(cfg, turno);
  if ('terminado' in preparado) return preparado.terminado;
  const { conv, tema } = preparado;
  const texto = turno.textoAgrupado;
  const saludo = esSoloSaludo(texto) ? saludoFijo(cfg, conv.idioma) : null;
  const resp = saludo ? null : await responderConModelo(cfg, conv, texto, esSoloSaludo(texto));
  // PC-21: falla de plataforma del proveedor (400/401/402): no se pausa ni se le escribe al huésped; una alerta
  // operativa y el mensaje queda sin atender (la bandeja lo reintenta y, pasados 15 min, lo escala).
  if (resp && 'plataforma' in resp) {
    await avisarFallaDePlataformaUnaVez(cfg, conv, resp.plataforma, texto);
    return { atendido: false };
  }
  // Justo antes de enviar: si una persona tomó la conversación mientras tanto, no se le pisa.
  if (await estaPausado(cfg, conv.id)) {
    console.log(`NO SE ENVÍA conv=${conv.chatwootConversationId} motivo=una persona tomó la conversación`);
    return ATENDIDO;
  }
  // ADR-11 / PC-14: antes de enviar se comprueba que el candado siga siendo NUESTRO. Si venció (turno muy largo,
  // Redis con problemas) otro turno puede estar respondiendo: este no envía y escala en vez de cruzar respuestas.
  if (candado && !(await candado.sigueSiendoMio())) {
    console.error(`NO SE ENVÍA conv=${conv.chatwootConversationId} motivo=el turno perdió el candado`);
    await avisarCandadoPerdido(cfg, conv.chatwootConversationId, texto).catch(avisarFallo('NO SE PUDO AVISAR EL CANDADO PERDIDO'));
    return { atendido: false };
  }
  if (saludo) {
    await enviarYGuardar(cfg, conv, saludo, { origen: 'saludo' });
    await avisarAlFinal(cfg, conv, texto, tema, []);
    return ATENDIDO;
  }
  // Si falló del todo o el modelo no sabía el dato: ya escala con su propio motivo. No se duplica el aviso.
  if (!resp) return { atendido: await escalarYGuardar(cfg, conv, texto, 'error_interno') };
  // Marca SIN texto: no hay nada que decirle al huésped → aviso fijo, aviso al equipo y pausa (como siempre).
  // Marca CON texto: el modelo sí respondió; el texto se envía y solo se avisa al equipo (abajo). #10 / V-17.
  if (resp.noSeElDato && !resp.texto) return { atendido: await escalarYGuardar(cfg, conv, texto, 'no_se_el_dato') };
  if (!resp.texto) return ATENDIDO;
  if (esRepeticion(conv, resp.texto, texto)) {
    console.log(`REPETICIÓN EVITADA conv=${conv.chatwootConversationId}`);
    await enviarYGuardar(cfg, conv, textoFijo(cfg, 'mensajeNoEntendi', conv.idioma), { origen: 'no_entendi' });
    await avisarAlFinal(cfg, conv, texto, tema, resp.herramientasUsadas);
    return ATENDIDO;
  }
  await enviarYGuardar(cfg, conv, resp.texto, {
    origen: 'llm', modelo: resp.modelo, tokensEntrada: resp.tokensEntrada,
    tokensSalida: resp.tokensSalida, latenciaMs: resp.latenciaMs, herramientas: resp.herramientasUsadas,
  });
  // Huella para el piloto: así se mide cuántas veces actúa la red de seguridad y se repasan las falsas alarmas.
  if (avisoPorRedDeSeguridad(null, resp.herramientasUsadas, resp.texto)) {
    console.log(`RED DE SEGURIDAD conv=${conv.chatwootConversationId} promesa="${enmascararSensibles(resp.texto).replace(/\s+/g, ' ').slice(0, 200)}"`);
  }
  await avisarAlFinal(cfg, conv, texto, tema, resp.herramientasUsadas, resp.texto, resp.noSeElDato);
  return ATENDIDO;
}

type Resp = Awaited<ReturnType<typeof llamarLLMConReintento>>;
type FallaPlataforma = { plataforma: number };

/** Una alerta operativa por cliente y estado cada 10 min, no una por huésped. Si Redis falla, se avisa igual. */
async function avisarFallaDePlataformaUnaVez(cfg: ClienteConfig, conv: ContextoConversacion, status: number, texto: string): Promise<void> {
  try {
    let primera = true;
    try {
      primera = (await redis.set(`plataforma:${cfg.id}:${status}`, '1', 'EX', 600, 'NX')) !== null;
    } catch {
      primera = true;
    }
    if (!primera) return;
    await avisarFallaDePlataforma(cfg, conv.chatwootConversationId, status, texto);
  } catch (e) {
    avisarFallo('NO SE PUDO AVISAR LA FALLA DE PLATAFORMA DEL MODELO')(e);
  }
}

/** Pide la respuesta al modelo. Devuelve null si falló del todo, o { plataforma } si fue una falla del proveedor. */
async function responderConModelo(
  cfg: ClienteConfig, conv: ContextoConversacion, texto: string, esSaludo: boolean,
): Promise<Resp | FallaPlataforma | null> {
  try {
    const r = await llamarLLMConReintento(
      armarMensajes(cfg, conv, texto, esSaludo), herramientas, { cfg, conv },
      { forzarHerramienta: !esSoloSaludo(texto) },
    );
    const h = r.herramientasUsadas.join(',');
    console.log(`LLM ${r.modelo} ${r.latenciaMs}ms tokens ${r.tokensEntrada}/${r.tokensSalida} herramientas=[${h}] noSe=${r.noSeElDato}`);
    return r;
  } catch (e) {
    console.error(`LLM FALLÓ DEL TODO status=${estadoHttp(e) ?? 'sin-status'}:`, e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    if (esFallaDePlataforma(e)) return { plataforma: estadoHttp(e) as number };
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
    if (conv.estadoBot === 'pausado') {
      // Una persona (o una escalación previa) tiene la conversación: el bot calla igual que en un turno normal.
      console.log(`SIN RESPUESTA conv=${conversationId} motivo=bot_pausado (recuperando un turno fallido)`);
      return ATENDIDO;
    }
    return { atendido: await escalarYGuardar(cfg, conv, turno.textoAgrupado, 'error_interno') };
  } catch (e) {
    // #13 / PC-20: si no se puede leer el estado de la conversación NO se sabe si una persona la tiene tomada.
    // Escribirle al huésped (y desasignar al agente) sería pisarla: solo se avisa al equipo.
    avisarFallo('NO SE PUDO LEER EL ESTADO DE LA CONVERSACIÓN: no se le escribe al huésped, se avisa al equipo')(e);
    const nota = '⚠️ El bot tuvo una falla técnica y NO pudo leer el estado de esta conversación, así que no le respondió al huésped '
      + `(podría estar atendiéndolo una persona). Revisa la conversación y respóndele tú si hace falta.\nMensaje del huésped: "${turno.textoAgrupado.slice(0, 300)}"`;
    const alerta = await alertarAlEquipo(cfg, conversationId, nota, { abrir: true });
    if (!alerta.avisado) {
      await registrarAvisoPendiente(cfg, conversationId, {
        nota, motivo: 'estado_ilegible', pausar: false, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
      });
    }
    return { atendido: alerta.avisado };
  }
}
