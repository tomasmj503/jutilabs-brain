import type { ClienteConfig, ContextoConversacion } from '../types/index.js';

/**
 * Ensambla el system prompt: cfg.promptBase + identidad/tono + idioma del huésped + reglas duras
 * (nunca inventar datos, un solo mensaje, presentarse como asistente virtual).
 * El texto base lo redacta Claude y vive en clientes.prompt_base. Aquí solo se ensambla.
 * TODO(qwen3-coder-flash).
 */
export function construirSystemPrompt(_cfg: ClienteConfig, _conv: ContextoConversacion): string {
  throw new Error('No implementado');
}
