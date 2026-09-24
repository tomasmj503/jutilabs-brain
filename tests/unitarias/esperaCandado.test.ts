import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: { LOCK_TTL_MS: 120_000 } }));
const conCandadoMock = vi.fn();
vi.mock('../../src/ingesta/lock.js', () => ({ conCandado: conCandadoMock }));

const { conCandadoEsperando } = await import('../../src/ingesta/esperaCandado.js');

describe('conCandadoEsperando: espera más que el vencimiento del candado', () => {
  beforeEach(() => { vi.useFakeTimers(); conCandadoMock.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('un candado huérfano (cerebro reiniciado a mitad de turno) que vence a los 110 s se alcanza a tomar', async () => {
    conCandadoMock.mockImplementation(async (_clave: string, fn: () => Promise<unknown>) =>
      Date.now() < 110_000 ? null : await fn());
    vi.setSystemTime(0);
    const corre = vi.fn(async () => 'listo');
    const p = conCandadoEsperando('k', corre);
    await vi.advanceTimersByTimeAsync(112_000);
    expect(await p).toEqual({ ok: true, valor: 'listo' });
    expect(corre).toHaveBeenCalledTimes(1);
  });

  it('solo se rinde pasado el vencimiento del candado + 30 s', async () => {
    conCandadoMock.mockResolvedValue(null);
    let resultado: unknown;
    void conCandadoEsperando('k', async () => 'x').then((r) => { resultado = r; });
    await vi.advanceTimersByTimeAsync(145_000);
    expect(resultado).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(resultado).toEqual({ ok: false });
  });
});
