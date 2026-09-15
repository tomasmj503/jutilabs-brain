import type { ClienteConfig } from '../types/index.js';

/** API de Chatwoot (token por cliente vía secretoPorRef(cfg.chatwootTokenRef)). TODO(qwen3-coder-plus). */
export async function enviarMensaje(_cfg: ClienteConfig, _conversationId: number, _texto: string): Promise<number> {
  throw new Error('No implementado');
}
export async function marcarPendiente(_cfg: ClienteConfig, _conversationId: number): Promise<void> {
  throw new Error('No implementado');
}
