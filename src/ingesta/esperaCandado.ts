import { env } from '../config/env.js';
import { conCandado } from './lock.js';

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Como conCandado, pero si la conversación está ocupada espera y reintenta en vez de descartar el turno.
 * Devuelve { ok:false } solo si se agota la espera (el llamador lo registra como error).
 * La espera por defecto es MAYOR que el vencimiento del candado: si el cerebro se reinicia a mitad de un
 * turno, el candado huérfano vence solo y los mensajes que esperan lo alcanzan a tomar.
 */
export async function conCandadoEsperando<T>(
  clave: string,
  fn: () => Promise<T>,
  maxEsperaMs = env.LOCK_TTL_MS + 30_000,
): Promise<{ ok: true; valor: T } | { ok: false }> {
  const limite = Date.now() + maxEsperaMs;
  for (;;) {
    // Se envuelve el resultado: así "ocupado" (null) no se confunde con un resultado null de fn.
    const r = await conCandado(clave, async () => ({ valor: await fn() }));
    if (r) return { ok: true, valor: r.valor };
    if (Date.now() >= limite) return { ok: false };
    await esperar(500);
  }
}
