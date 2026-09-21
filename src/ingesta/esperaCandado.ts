import { conCandado } from './lock.js';

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Como conCandado, pero si la conversación está ocupada espera y reintenta en vez de descartar el turno.
 * Devuelve { ok:false } solo si se agota la espera (el llamador lo registra como error).
 */
export async function conCandadoEsperando<T>(
  clave: string,
  fn: () => Promise<T>,
  maxEsperaMs = 90_000,
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
