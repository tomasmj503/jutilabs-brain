import type { ClienteConfig, ContextoConversacion, HerramientaLLM, RespuestaLLM } from '../types/index.js';

/**
 * ÚNICA función que habla con OpenRouter (SDK de openai, baseURL = OPENROUTER_BASE_URL).
 * - Clave: secretoPorRef(cfg.openrouterKeyRef)
 * - Modelo: cfg.llmModelo; si falla (timeout/5xx) reintenta UNA vez con cfg.llmModeloRespaldo
 * - Tool calling: máximo 3 rondas de herramientas por turno
 * - Devuelve UN texto final. Si el modelo indica que no tiene el dato → noSeElDato = true (el router escala)
 * TODO(qwen3-coder-plus). Contrato en src/types.
 */
export async function llamarLLM(
  _mensajes: Array<{ rol: 'system' | 'user' | 'assistant'; contenido: string }>,
  _herramientas: HerramientaLLM[],
  _ctx: { cfg: ClienteConfig; conv: ContextoConversacion },
): Promise<RespuestaLLM> {
  throw new Error('No implementado');
}
