/**
 * ¿La llamada al modelo se cortó por la red (ECONNRESET, SSL cortado...)? El SDK de OpenAI lo lanza como APIConnectionError,
 * sin código HTTP. El tiempo agotado (APIConnectionTimeoutError, 25 s) NO cuenta: ya esperó todo y repetir duplicaría la espera.
 * Se detecta por el nombre de la clase (no con instanceof) para no depender de cómo se carga el SDK; una prueba usa los errores reales.
 */
export function esCorteDeConexion(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  return (e as { status?: unknown }).status === undefined && e.constructor?.name === 'APIConnectionError';
}

/** Causa corta para el log: el código del sistema (ECONNRESET) o el mensaje. */
export function causaDelCorte(e: unknown): string {
  const causa = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  return causa?.code ?? causa?.message ?? (e instanceof Error ? e.message : String(e));
}
