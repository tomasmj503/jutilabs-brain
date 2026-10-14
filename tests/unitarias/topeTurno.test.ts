import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ADR-11: tope DURO por turno. Las llamadas al modelo del turno comparten una señal que se aborta a los 90 s.
const llamarLLM = vi.fn();
vi.mock('../../src/llm/llamarLLM.js', () => ({ llamarLLM }));
const { llamarLLMConReintento } = await import('../../src/llm/conReintento.js');
const { TOPE_TURNO_MS } = await import('../../src/llm/topeTurno.js');

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); llamarLLM.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('tope duro del turno', () => {
  it('el tope es de 90 s (propuesta del ADR-11)', () => {
    expect(TOPE_TURNO_MS).toBe(90_000);
  });

  it('pasa una señal a llamarLLM y la aborta al agotarse el tope', async () => {
    let senal: AbortSignal | undefined;
    llamarLLM.mockImplementation((_m: unknown, _h: unknown, _c: unknown, o: { signal: AbortSignal }) => {
      senal = o.signal;
      return new Promise((_ok, no) => o.signal.addEventListener('abort', () => no(new Error('abortado'))));
    });
    const p = llamarLLMConReintento([], [], { cfg: {}, conv: {} } as never).then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(TOPE_TURNO_MS + 10);
    expect(senal?.aborted).toBe(true);
    expect(await p).toBe('abortado');
    expect(llamarLLM).toHaveBeenCalledTimes(1); // abortado: no se reintenta
  });

  it('si responde a tiempo no queda ningún temporizador pendiente', async () => {
    llamarLLM.mockResolvedValue({ texto: 'hola' });
    await llamarLLMConReintento([], [], { cfg: {}, conv: {} } as never);
    expect(vi.getTimerCount()).toBe(0);
  });
});
