import type { ClienteConfig, MotivoEscalamiento } from '../types/index.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from './chatwoot.js';
import { pausarBot } from '../conversacion/estado.js';

const MENSAJE_RESPALDO =
  'Quiero darte la información correcta 🙏 Déjame pasar esta consulta a nuestro equipo para confirmarla.';

/** Mensaje fijo de "lo paso al equipo", por idioma, desde Supabase. Nunca se usa el texto del modelo. */
function mensajeNoSe(cfg: ClienteConfig, idioma: string): string {
  const m = cfg.configExtra.mensajeNoSeElDato as Record<string, unknown> | null | undefined;
  const texto = m?.[idioma] ?? m?.[cfg.idiomaDefault];
  return typeof texto === 'string' && texto.trim() ? texto : MENSAJE_RESPALDO;
}

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
  const texto = mensajeNoSe(cfg, idioma);
  const mensajeId = await enviarMensaje(cfg, conversationId, texto);
  const causa = motivo === 'error_interno' ? 'falla técnica del bot (no fue falta de dato)' : 'no tenía el dato para responder';
  const nota = `🤖 Escalado por el bot: ${causa}.\nPregunta del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  await conUnReintento('pausar', conversationId, () => pausarBot(cfg, conversationId, motivo));
  return { texto, mensajeId };
}
