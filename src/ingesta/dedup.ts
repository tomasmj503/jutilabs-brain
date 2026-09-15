/** Devuelve true si el message_id ya fue visto (Redis SET NX con TTL 24 h). TODO(qwen3-coder-flash). */
export async function yaProcesado(_clienteId: string, _chatwootMessageId: number): Promise<boolean> {
  throw new Error('No implementado');
}
