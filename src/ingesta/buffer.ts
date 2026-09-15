import type { MensajeEntrante, TurnoEntrante } from '../types/index.js';

/**
 * Agrupa mensajes de una misma conversación durante BUFFER_MS y emite un TurnoEntrante.
 * Clave Redis: buffer:{clienteId}:{conversationId}. Reinicia el temporizador con cada mensaje nuevo.
 * TODO(qwen3-coder-plus).
 */
export async function agregarAlBuffer(_msg: MensajeEntrante): Promise<TurnoEntrante | null> {
  throw new Error('No implementado');
}
