import type { ClienteConfig } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { reactivarBot } from '../conversacion/estado.js';
import { limpiarAvisoPendiente } from '../conversacion/avisoPendiente.js';
import { modoAgentBot } from '../config/agentBot.js';
import { cambiarEstado, enviarNotaPrivada, idUsuarioBot } from '../salida/chatwoot.js';

/**
 * D-08 — «Devuelta a Max»: el chat vuelve al bot SOLO cuando una persona del equipo escribe la nota PRIVADA «#max».
 * Nunca por tiempo, ni al resolver, ni al desasignar, ni con un mensaje público.
 */
const COMANDO = /^\s*#max\b/i;

/** ¿Es una nota privada que empieza por «#max»? (Quién la escribió se comprueba aparte, en procesarLiberacion.) */
export function esComandoLiberar(a: Pick<Aviso, 'privado' | 'direccion' | 'contenido'>): boolean {
  return a.privado && a.direccion === 'saliente' && COMANDO.test(a.contenido);
}

/**
 * Libera la conversación. Solo cuenta si la escribió un USUARIO de Chatwoot (sender.type "user") que no sea el bot: el bot
 * deja notas privadas que citan lo que escribió el huésped, y un huésped que escribiera «#max» no debe poder destrabarse
 * solo. En modo Agent Bot las notas del bot salen como "agent_bot" y además la conversación vuelve a "pending"; en el
 * modo anterior el bot es un usuario más y se distingue por su id (/api/v1/profile). Nunca lanza.
 */
export async function procesarLiberacion(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || !esComandoLiberar(a)) return;
  if (a.remitenteTipo !== 'user' || a.remitenteId === null) return;
  const modoBot = modoAgentBot(cfg);
  if (!modoBot) {
    let botId: number | null;
    try {
      botId = await idUsuarioBot(cfg);
    } catch (e) {
      // Sin saber quién es el bot no se puede distinguir su nota de la de una persona: no se libera.
      console.error(`LIBERACIÓN: no se pudo saber quién es el bot conv=${conversationId}; no se libera:`, e instanceof Error ? e.message : e);
      return;
    }
    if (botId === null || a.remitenteId === botId) return;
  }
  if (a.messageId !== null && (await yaProcesado(cfg.id, a.messageId))) return;
  try {
    await reactivarBot(cfg, conversationId);
    // En modo Agent Bot el bot solo atiende en "pending": sin esto seguiría callado aunque Supabase ya lo tenga activo.
    if (modoBot) await cambiarEstado(cfg, conversationId, 'pending');
    // Un aviso viejo pendiente que quisiera volver a pausarla o escribirle al huésped ya no aplica.
    await limpiarAvisoPendiente(cfg, conversationId).catch((e) => {
      console.error(`LIBERACIÓN: no se pudo limpiar el aviso pendiente conv=${conversationId}:`, e instanceof Error ? e.message : e);
    });
    console.log(`BOT LIBERADO conv=${conversationId} por #max (usuario ${a.remitenteId})`);
    await enviarNotaPrivada(cfg, conversationId, '✅ Max volvió a atender esta conversación (liberada con #max).')
      .catch(() => undefined);
  } catch (e) {
    console.error(`LIBERACIÓN FALLÓ conv=${conversationId}:`, e instanceof Error ? e.message : e);
    await enviarNotaPrivada(cfg, conversationId,
      '⚠️ NO se pudo devolver la conversación a Max (falla técnica). Vuelve a escribir #max en unos minutos'
      + (modoBot ? ' (si ya no responde, revisa que la conversación esté en estado Pendiente).' : '.'))
      .catch(() => undefined);
  }
}
