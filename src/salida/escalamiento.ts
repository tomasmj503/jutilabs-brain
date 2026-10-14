import { causaDelEscalamiento } from './causaEscalamiento.js';
import type { ClienteConfig, MotivoEscalamiento } from '../types/index.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from './chatwoot.js';
import { pausarBot } from '../conversacion/estado.js';
import { registrarAvisoPendiente } from '../conversacion/avisoPendiente.js';
import { textoFijo } from '../ingesta/textosFijos.js';
import { EnvioIncierto } from './errores.js';
import { alertarAlEquipo, conUnReintento } from './alertaEquipo.js';
import { avisarAlCelular } from './avisoEquipo.js';

export type ResultadoEscalamiento = {
  texto: string;
  /** null si el aviso al huésped no salió (o no se pudo confirmar): no hay mensaje que guardar. */
  mensajeId: number | null;
  /** 'no_enviado': ni se intentó, porque el equipo no quedó avisado (PC-15). */
  envio: 'enviado' | 'fallo' | 'incierto' | 'no_enviado';
  /** El equipo quedó avisado de forma CONFIRMADA. Si es false hay un aviso pendiente que reintenta el barrido. */
  avisado: boolean;
};

/**
 * Pausa el bot. PC-10: si la pausa falla (después de un reintento) el bot puede seguir hablando encima de una persona
 * sin que nadie lo sepa, así que se avisa al equipo con una alerta propia y, si ni eso sale, queda pendiente
 * (el barrido reintenta la pausa cuando el aviso por fin se confirme).
 */
export async function pausarOAlertar(cfg: ClienteConfig, conversationId: number, motivo: string): Promise<boolean> {
  const ok = await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, motivo));
  if (ok) return true;
  const nota = `🚨 NO SE PUDO PAUSAR el bot en esta conversación (${motivo}). Puede seguir contestándole al huésped aunque `
    + 'una persona lo esté atendiendo: revisa la conversación y avisa al equipo técnico.';
  const alerta = await alertarAlEquipo(cfg, conversationId, nota);
  if (!alerta.avisado) {
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo, pausar: true, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
    });
  }
  return false;
}

const AVISO_EQUIPO = {
  fallo: '⚠️ El aviso al huésped NO salió (falla de red): escríbele tú.',
  incierto: '⚠️ No se pudo confirmar si el aviso llegó al huésped: revisa la conversación antes de escribirle.',
} as const;

/**
 * Avisa al equipo (nota privada + abrir + celular) y, SOLO si el equipo quedó avisado de forma confirmada, pausa el bot
 * y le escribe al huésped que su solicitud fue compartida (PC-15: nunca decir «ya avisé» si no salió).
 * Si el aviso no se confirma: no se pausa, no se le escribe al huésped y queda un aviso pendiente que el barrido
 * de la bandeja reintenta (y, al confirmarse, completa la pausa y el texto).
 */
export async function responderYEscalar(
  cfg: ClienteConfig,
  conversationId: number,
  idioma: string,
  pregunta: string,
  motivo: MotivoEscalamiento = 'no_se_el_dato',
): Promise<ResultadoEscalamiento> {
  const texto = textoFijo(cfg, motivo === 'pidio_humano' ? 'mensajeHumano' : 'mensajeNoSeElDato', idioma);
  const nota = `🤖 Escalado por el bot: ${causaDelEscalamiento(motivo)}.\nPregunta del huésped: "${pregunta.slice(0, 300)}"`;
  const alerta = await alertarAlEquipo(cfg, conversationId, nota, { abrir: true });
  if (!alerta.avisado) {
    console.error(`ESCALAMIENTO SIN AVISO CONFIRMADO conv=${conversationId} motivo=${motivo} nota=${alerta.nota} celular=${alerta.celular}: no se pausa ni se le escribe al huésped; queda pendiente`);
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo, pausar: true, textoHuesped: texto, idioma, notaCreada: alerta.nota,
    });
    return { texto, mensajeId: null, envio: 'no_enviado', avisado: false };
  }
  await pausarOAlertar(cfg, conversationId, motivo);
  let mensajeId: number | null = null;
  let envio: ResultadoEscalamiento['envio'] = 'enviado';
  try {
    mensajeId = await enviarMensaje(cfg, conversationId, texto);
  } catch (e) {
    envio = e instanceof EnvioIncierto ? 'incierto' : 'fallo';
    console.error(`ESCALAMIENTO: EL AVISO AL HUÉSPED NO SALIÓ (${envio}) conv=${conversationId}:`, e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
  }
  if (envio !== 'enviado') {
    // El equipo ya estaba avisado: se le agrega que el huésped NO recibió el aviso (para que le escriban ellos).
    const aviso = AVISO_EQUIPO[envio];
    await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, aviso));
    await avisarAlCelular(cfg, conversationId, aviso);
  }
  return { texto, mensajeId, envio, avisado: true };
}

/**
 * La respuesta del bot al huésped pudo haber salido o no y no se pudo confirmar. NO se manda nada más al
 * huésped (podría recibir dos mensajes); solo se avisa al equipo, se abre la conversación y se pausa el bot.
 * Devuelve true si el equipo quedó avisado (si no, queda pendiente y NO se pausa).
 */
export async function alertarEnvioIncierto(cfg: ClienteConfig, conversationId: number, pregunta: string): Promise<boolean> {
  const nota = `⚠️ El bot no pudo confirmar si su respuesta llegó al huésped. Revisa la conversación y, si hace falta, respóndele tú.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`;
  const alerta = await alertarAlEquipo(cfg, conversationId, nota, { abrir: true });
  if (!alerta.avisado) {
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo: 'error_interno', pausar: true, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
    });
    return false;
  }
  await pausarOAlertar(cfg, conversationId, 'error_interno');
  return true;
}

/**
 * Tema de alto valor (India, voluntariado, etc.): el modelo YA respondió con la info real,
 * así que aquí NO se manda un segundo mensaje al huésped (un solo mensaje de salida por turno).
 * Solo se avisa al equipo y se pausa el bot. Devuelve true si el equipo quedó avisado.
 */
export async function avisarEquipoYPausar(
  cfg: ClienteConfig,
  conversationId: number,
  motivo: MotivoEscalamiento,
  pregunta: string,
): Promise<boolean> {
  const nota = `⭐ Tema de alto valor detectado (${motivo}): revisar y dar seguimiento.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`;
  const alerta = await alertarAlEquipo(cfg, conversationId, nota, { abrir: true });
  if (!alerta.avisado) {
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo, pausar: true, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
    });
    return false;
  }
  await pausarOAlertar(cfg, conversationId, motivo);
  return true;
}

/**
 * Meta rechazó DESPUÉS de aceptarlo un mensaje que salió por Chatwoot (Chatwoot lo marca "failed").
 * Nota privada + conversación abierta para que el equipo se entere. NO reenvía nada al huésped
 * (la mayoría de los motivos, como la ventana de 24 h o un número inválido, no se arreglan repitiendo).
 * Si la nota no se puede dejar, LANZA el error: quien llama deshace la marca de "ya avisado" para reintentar luego.
 */
export async function avisarMensajeFallido(
  cfg: ClienteConfig, conversationId: number, fallo: { error: string | null; contenido: string },
): Promise<void> {
  const motivo = fallo.error ?? 'Meta no informó el motivo';
  const nota = `⚠️ Un mensaje NO llegó al huésped: WhatsApp (Meta) lo rechazó después de aceptarlo.\nMotivo que informa Meta: ${motivo}\nMensaje: "${fallo.contenido.slice(0, 300)}"\nQué hacer: revisa la conversación y, si hace falta, contacta al huésped por otro medio. Ojo: el botón "Reintentar" de Chatwoot puede marcarlo como enviado sin reenviarlo; si lo usas, confirma que sí llegó.`;
  await enviarNotaPrivada(cfg, conversationId, nota);
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  const celular = await avisarAlCelular(cfg, conversationId, nota);
  if (celular === 'fallido') {
    // La nota ya quedó; lo que falta es el aviso al celular. Se reintenta desde el barrido en vez de perderlo.
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo: 'mensaje_fallido', pausar: false, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: true,
    });
  }
}

/**
 * Un tema de la lista del cliente (India, voluntariado…) apareció en la conversación. El modelo ya respondió con la
 * información real; aquí solo se le avisa al equipo (nota privada + celular), SIN pausar, SIN abrir ni desasignar y
 * sin escribirle nada al huésped. Si el aviso no se confirma queda pendiente. Devuelve true si el equipo quedó avisado.
 */
export async function avisarTema(cfg: ClienteConfig, conversationId: number, tema: string, pregunta: string): Promise<boolean> {
  return avisarSinPausar(cfg, conversationId, 'tema',
    `⭐ Tema de interés detectado (${tema}): el bot sigue atendiendo; revisa si hace falta dar seguimiento.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`);
}

/**
 * El modelo respondió pero marcó que no tenía todos los datos ([[NO_SE]] con texto). Su texto SÍ salió; se avisa al
 * equipo para que lo complete, sin pausar (#10 / V-17).
 */
export async function avisarRespuestaParcial(cfg: ClienteConfig, conversationId: number, pregunta: string): Promise<boolean> {
  return avisarSinPausar(cfg, conversationId, 'respuesta_parcial',
    `ℹ️ El bot respondió, pero marcó que NO tenía todos los datos: revisa si la respuesta fue suficiente y complétala.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`);
}

async function avisarSinPausar(cfg: ClienteConfig, conversationId: number, motivo: string, nota: string): Promise<boolean> {
  const alerta = await alertarAlEquipo(cfg, conversationId, nota);
  if (!alerta.avisado) {
    await registrarAvisoPendiente(cfg, conversationId, {
      nota, motivo, pausar: false, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
    });
  }
  return alerta.avisado;
}
