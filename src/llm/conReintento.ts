import { llamarLLM } from './llamarLLM.js';

type Args = Parameters<typeof llamarLLM>;

/**
 * Reintenta una vez si el modelo falla RÁPIDO (red, DNS). Cada intento ya prueba el modelo de respaldo.
 * Si la falla fue lenta (tiempo agotado) no se repite: el candado de la conversación vence a los 60 s.
 */
export async function llamarLLMConReintento(...args: Args): Promise<Awaited<ReturnType<typeof llamarLLM>>> {
  const inicio = Date.now();
  try {
    return await llamarLLM(...args);
  } catch (e) {
    if (Date.now() - inicio > 8_000) throw e;
    console.error('LLM FALLÓ, se reintenta una vez:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    await new Promise((r) => setTimeout(r, 1500));
    return await llamarLLM(...args);
  }
}
