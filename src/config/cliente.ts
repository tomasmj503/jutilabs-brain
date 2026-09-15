import type { ClienteConfig } from '../types/index.js';

/**
 * Carga la configuración de un cliente desde Supabase (tabla clientes) con cache en memoria (TTL corto).
 * TODO(qwen3-coder-plus): implementar con src/db/supabase.ts. Mapear snake_case → camelCase de ClienteConfig.
 * Regla: si clientes.activo = false o bot_activo = false, la ingesta ignora el mensaje (kill-switch).
 */
export async function cargarClientePorChatwootAccount(_chatwootAccountId: number): Promise<ClienteConfig | null> {
  throw new Error('No implementado');
}
