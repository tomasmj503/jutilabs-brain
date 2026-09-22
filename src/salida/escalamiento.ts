import type { ClienteConfig, MotivoEscalamiento } from '../types/index.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from './chatwoot.js';
import { pausarBot } from '../conversacion/estado.js';
import { textoFijo } from '../ingesta/textosFijos.js';


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

/** Avisa al huésped, deja nota privada, abre la conversación para el equipo y pausa el bot. */
export async function responderYEscalar(
  cfg: ClienteConfig,
  conversationId: number,
  idioma: string,
  pregunta: string,
  motivo: MotivoEscalamiento = 'no_se_el_dato',
): Promise<{ texto: string; mensajeId: number }> {
  const texto = textoFijo(cfg, 'mensajeNoSeElDato', idioma);
  const mensajeId = await enviarMensaje(cfg, conversationId, texto);
  const causa = motivo === 'error_interno' ? 'falla técnica del bot (no fue falta de dato)' : 'no tenía el dato para responder';
  const nota = `🤖 Escalado por el bot: ${causa}.\nPregunta del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, motivo));
  return { texto, mensajeId };
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
