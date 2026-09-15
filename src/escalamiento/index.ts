import type { ClienteConfig, ContextoConversacion, MotivoEscalamiento } from '../types/index.js';

/**
 * 1) Un único mensaje de aviso al huésped (texto desde config del cliente, en su idioma)
 * 2) conversaciones.estado_bot = 'pausado', motivo, escalado_at
 * 3) Chatwoot: marcar pendiente
 * 4) POST N8N_WEBHOOK_AVISOS (n8n manda el WhatsApp a Diego/Andrea) — con N8N_WEBHOOK_SECRET
 * Reactivación: agente resuelve en Chatwoot (webhook conversation_status_changed) o cfg.reactivacionHoras sin actividad.
 * TODO(qwen3-coder-plus).
 */
export async function escalar(
  _cfg: ClienteConfig,
  _conv: ContextoConversacion,
  _motivo: MotivoEscalamiento,
  _resumen: string,
): Promise<void> {
  throw new Error('No implementado');
}
