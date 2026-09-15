/** Candado por conversación (Redis SET NX PX LOCK_TTL_MS). Garantiza un solo turno en proceso. TODO(qwen3-coder-flash). */
export async function conCandado<T>(_clave: string, _fn: () => Promise<T>): Promise<T | null> {
  throw new Error('No implementado');
}
