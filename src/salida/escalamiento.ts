import type { ClienteConfig, MotivoEscalamiento } from '../types/index.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from './chatwoot.js';
import { pausarBot } from '../conversacion/estado.js';
import { textoFijo } from '../ingesta/textosFijos.js';
import { EnvioIncierto } from './errores.js';


async function conUnReintento(paso: string, conversationId: number, f: () => Promise<void>): Promise<void> {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      await f();
      return;
    } catch (e) {
      console.error(`ESCALAMIENTO FALLÓ paso=${paso} intento=${intento} conv=${conversationId}:`, e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    }
  }
}

export type ResultadoEscalamiento = {
  texto: string;
  /** null si el aviso al huésped no salió (o no se pudo confirmar): no hay mensaje que guardar. */
  mensajeId: number | null;
  envio: 'enviado' | 'fallo' | 'incierto';
};

const AVISO_EQUIPO = {
  fallo: '\n⚠️ El aviso al huésped NO salió (falla de red): escríbele tú.',
  incierto: '\n⚠️ No se pudo confirmar si el aviso llegó al huésped: revisa la conversación antes de escribirle.',
} as const;

/**
 * Avisa al huésped, deja nota privada, abre la conversación para el equipo y pausa el bot.
 * Que el aviso al huésped falle NO frena lo demás: el equipo tiene que enterarse justamente en ese caso.
 */
export async function responderYEscalar(
  cfg: ClienteConfig,
  conversationId: number,
  idioma: string,
  pregunta: string,
  motivo: MotivoEscalamiento = 'no_se_el_dato',
): Promise<ResultadoEscalamiento> {
  const texto = textoFijo(cfg, 'mensajeNoSeElDato', idioma);
  let mensajeId: number | null = null;
  let envio: ResultadoEscalamiento['envio'] = 'enviado';
  try {
    mensajeId = await enviarMensaje(cfg, conversationId, texto);
  } catch (e) {
    envio = e instanceof EnvioIncierto ? 'incierto' : 'fallo';
    console.error(`ESCALAMIENTO: EL AVISO AL HUÉSPED NO SALIÓ (${envio}) conv=${conversationId}:`, e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
  }
  const causa = motivo === 'error_interno' ? 'falla técnica del bot (no fue falta de dato)' : 'no tenía el dato para responder';
  const aviso = envio === 'enviado' ? '' : AVISO_EQUIPO[envio];
  const nota = `🤖 Escalado por el bot: ${causa}.${aviso}\nPregunta del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, motivo));
  return { texto, mensajeId, envio };
}

/**
 * La respuesta del bot al huésped pudo haber salido o no y no se pudo confirmar. NO se manda nada más al
 * huésped (podría recibir dos mensajes); solo se avisa al equipo, se abre la conversación y se pausa el bot.
 */
export async function alertarEnvioIncierto(cfg: ClienteConfig, conversationId: number, pregunta: string): Promise<void> {
  const nota = `⚠️ El bot no pudo confirmar si su respuesta llegó al huésped. Revisa la conversación y, si hace falta, respóndele tú.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, 'error_interno'));
}

/**
 * Tema de alto valor (India, voluntariado, etc.): el modelo YA respondió con la info real,
 * así que aquí NO se manda un segundo mensaje al huésped (un solo mensaje de salida por turno).
 * Solo se avisa al equipo y se pausa el bot.
 */
export async function avisarEquipoYPausar(
  cfg: ClienteConfig,
  conversationId: number,
  motivo: MotivoEscalamiento,
  pregunta: string,
): Promise<void> {
  const nota = `⭐ Tema de alto valor detectado (${motivo}): revisar y dar seguimiento.\nMensaje del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, motivo));
}
