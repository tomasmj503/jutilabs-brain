import type { ClienteConfig } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { desmarcarFalloAvisado, marcarFalloAvisado } from './dedup.js';
import { consultarEstadoMensaje } from '../salida/chatwoot.js';
import { avisarMensajeFallido } from '../salida/escalamiento.js';

/**
 * message_updated: Chatwoot avisa cada vez que cambia un mensaje (enviado → entregado → leído, o "failed").
 * Solo interesa un mensaje SALIENTE (no nota privada) que Meta rechazó después de aceptarlo.
 * El aviso no es de fiar (en 4.17.0 puede no traer el estado): si no dice claramente que todo va bien,
 * se VERIFICA con la API. Se avisa al equipo una sola vez por mensaje. Sin reenvío automático.
 */
export async function procesarActualizacion(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  const messageId = a.messageId;
  if (conversationId === null || messageId === null || a.privado || a.direccion !== 'saliente') return;
  // El aviso trae un estado y no hay señal de error: no vale la pena preguntar a la API.
  if (a.estado !== null && a.estado !== 'failed' && a.errorExterno === null) return;

  const v = await consultarEstadoMensaje(cfg, conversationId, messageId);
  if (v.estado === 'ok') return;
  if (v.estado !== 'fallido') {
    if (a.estado === 'failed' || a.errorExterno !== null) {
      console.error(`MENSAJE FALLIDO SIN VERIFICAR conv=${conversationId} mensaje=${messageId} verificación=${v.estado}: el aviso decía que falló, no se pudo confirmar`);
    }
    return;
  }
  if (!(await marcarFalloAvisado(cfg.id, messageId))) return; // ya se avisó de este mensaje
  try {
    await avisarMensajeFallido(cfg, conversationId, { error: v.error ?? a.errorExterno, contenido: v.contenido || a.contenido });
    console.warn(`MENSAJE FALLIDO AVISADO conv=${conversationId} mensaje=${messageId} motivo=${v.error ?? 'sin motivo'}`);
  } catch (e) {
    await desmarcarFalloAvisado(cfg.id, messageId).catch(() => undefined);
    console.error(`MENSAJE FALLIDO: NO SE PUDO AVISAR AL EQUIPO conv=${conversationId} mensaje=${messageId}:`, e instanceof Error ? e.message : e);
  }
}
