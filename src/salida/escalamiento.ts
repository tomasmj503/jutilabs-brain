import type { ClienteConfig } from '../types/index.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from './chatwoot.js';

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

/** El bot no tiene el dato: avisa al huésped, deja nota privada y deja la conversación abierta para el equipo. */
export async function responderYEscalar(
  cfg: ClienteConfig,
  conversationId: number,
  idioma: string,
  pregunta: string,
): Promise<void> {
  await enviarMensaje(cfg, conversationId, mensajeNoSe(cfg, idioma));
  const nota = `🤖 Escalado por el bot: no tenía el dato para responder.\nPregunta del huésped: "${pregunta.slice(0, 300)}"`;
  await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
}
