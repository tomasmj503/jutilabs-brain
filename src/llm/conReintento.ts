import { llamarLLM } from './llamarLLM.js';
import { estadoHttp } from './fallaPlataforma.js';
import { TOPE_TURNO_MS } from './topeTurno.js';

export { esFallaDePlataforma } from './fallaPlataforma.js';

type Args = Parameters<typeof llamarLLM>;

/**
 * Reintenta una vez SOLO si el modelo falla RÁPIDO por un error de red (sin código HTTP: DNS, conexión). Cada intento
 * ya prueba el modelo de respaldo. Cualquier error con código HTTP NO se repite (PC-21 / V-22):
 *   · 400, 401 y 402 son fallas de plataforma: repetirlas no las arregla (y cada llamada cuesta tiempo);
 *   · 5xx y 429 ya pasaron por el modelo de respaldo dentro de llamarLLM.
 * Si la falla fue lenta (tiempo agotado) no se repite: el candado de la conversación (LOCK_TTL_MS) sigue corriendo.
 */
export async function llamarLLMConReintento(
  mensajes: Args[0], herramientas: Args[1], ctx: Args[2], opciones: Args[3] = {},
): Promise<Awaited<ReturnType<typeof llamarLLM>>> {
  // Un solo tope para TODO el turno con el modelo: intento, reintento y respaldo.
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(new Error(`Tope del turno (${TOPE_TURNO_MS} ms) agotado`)), TOPE_TURNO_MS);
  const conSenal = { ...opciones, signal: controlador.signal };
  const inicio = Date.now();
  try {
    try {
      return await llamarLLM(mensajes, herramientas, ctx, conSenal);
    } catch (e) {
      if (controlador.signal.aborted || estadoHttp(e) !== undefined) throw e;
      if (Date.now() - inicio > 8_000) throw e;
      console.error('LLM FALLÓ POR RED, se reintenta una vez:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
      await new Promise((r) => setTimeout(r, 1500));
      return await llamarLLM(mensajes, herramientas, ctx, conSenal);
    }
  } finally {
    clearTimeout(reloj);
  }
}
