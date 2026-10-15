import { describe, it, expect, vi, beforeEach } from 'vitest';

// #9 / PC-21 (UNI-LLM): se reintenta SOLO ante un error de red (sin código HTTP). 400, 401 y 402 son falla de plataforma:
// repetir la llamada solo gasta tiempo y dinero.
const llamarLLM = vi.fn();
vi.mock('../../src/llm/llamarLLM.js', () => ({ llamarLLM }));

const { llamarLLMConReintento, esFallaDePlataforma } = await import('../../src/llm/conReintento.js');

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const ok = { texto: 'hola' };
const args = [[], [], { cfg: {}, conv: {} }] as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function correr() {
  const p = llamarLLMConReintento(...(args as Parameters<typeof llamarLLMConReintento>));
  const resultado = p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
  await vi.advanceTimersByTimeAsync(5_000);
  return resultado;
}

describe('llamarLLMConReintento', () => {
  it.each([[400], [401], [402]])('HTTP %i: UNA sola llamada, sin reintento', async (status) => {
    llamarLLM.mockRejectedValue(http(status));
    const r = await correr();
    expect(r.ok).toBe(false);
    expect(llamarLLM).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 / 429 (el respaldo ya se probó dentro de llamarLLM): tampoco se repite el turno entero', async () => {
    llamarLLM.mockRejectedValue(http(503));
    await correr();
    expect(llamarLLM).toHaveBeenCalledTimes(1);
  });

  it('error de red sin código HTTP: se reintenta una vez y puede salir bien', async () => {
    llamarLLM.mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN')).mockResolvedValueOnce(ok);
    const r = await correr();
    expect(r).toEqual({ ok: true, v: ok });
    expect(llamarLLM).toHaveBeenCalledTimes(2);
  });

  it('error de red dos veces: se rinde tras el segundo intento', async () => {
    llamarLLM.mockRejectedValue(new Error('ECONNRESET'));
    const r = await correr();
    expect(r.ok).toBe(false);
    expect(llamarLLM).toHaveBeenCalledTimes(2);
  });
});

describe('esFallaDePlataforma', () => {
  it('400, 401 y 402 sí; 429, 5xx, red y errores sin estado no', () => {
    expect([400, 401, 402].every((s) => esFallaDePlataforma(http(s)))).toBe(true);
    expect([404, 429, 500, 502].some((s) => esFallaDePlataforma(http(s)))).toBe(false);
    expect(esFallaDePlataforma(new Error('red'))).toBe(false);
    expect(esFallaDePlataforma(null)).toBe(false);
  });
});
