import { describe, it, expect, vi } from 'vitest';
import { clasificarFalloDeRed, crearFetch, esFalloDeRed } from '../../src/red/reintento.js';

/** Error como el que lanza fetch de Node: TypeError("fetch failed") con la causa real dentro. */
const falloDeRed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const ok = (status = 200) => new Response('{}', { status });

function armar(politica: 'segura' | 'solo-si-no-salio', respuestas: Array<Response | Error>, extra = {}) {
  const cola = [...respuestas];
  const base = vi.fn(async () => {
    const siguiente = cola.shift();
    if (siguiente === undefined) throw new Error('la prueba se quedó sin respuestas');
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  });
  const esperar = vi.fn(async () => undefined);
  const f = crearFetch({ nombre: 't', politica, timeoutMs: 1000, base: base as unknown as typeof fetch, esperar, ...extra });
  return { f, base, esperar };
}

describe('clasificarFalloDeRed', () => {
  it('nombre no traducido (EAI_AGAIN) y conexión rechazada: la petición nunca salió', () => {
    expect(clasificarFalloDeRed(falloDeRed('EAI_AGAIN'))).toBe('no-salio');
    expect(clasificarFalloDeRed(falloDeRed('ECONNREFUSED'))).toBe('no-salio');
    expect(clasificarFalloDeRed(falloDeRed('UND_ERR_CONNECT_TIMEOUT'))).toBe('no-salio');
  });
  it('corte a mitad de camino o tiempo agotado: puede que sí haya llegado', () => {
    expect(clasificarFalloDeRed(falloDeRed('ECONNRESET'))).toBe('quiza-salio');
    expect(clasificarFalloDeRed(falloDeRed('UND_ERR_SOCKET'))).toBe('quiza-salio');
    expect(clasificarFalloDeRed(new DOMException('agotado', 'TimeoutError'))).toBe('quiza-salio');
  });
  it('varias direcciones (AggregateError): solo "no salió" si TODAS lo prueban', () => {
    const todas = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([]), { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] }) });
    const mezcla = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([]), { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNRESET' }] }) });
    expect(clasificarFalloDeRed(todas)).toBe('no-salio');
    expect(clasificarFalloDeRed(mezcla)).toBe('quiza-salio');
  });
  it('un error de código nuestro no es una falla de red', () => {
    expect(esFalloDeRed(new Error('boom'))).toBe(false);
    expect(esFalloDeRed(falloDeRed('EAI_AGAIN'))).toBe(true);
  });
});

describe('política segura (lecturas y guardados repetibles)', () => {
  it('reintenta ante cualquier falla de red y termina bien al tercer intento', async () => {
    const { f, base, esperar } = armar('segura', [falloDeRed('EAI_AGAIN'), falloDeRed('ECONNRESET'), ok()]);
    const r = await f('https://x.test/a');
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
    expect(esperar).toHaveBeenNthCalledWith(1, 400);
    expect(esperar).toHaveBeenNthCalledWith(2, 1200);
  });
  it('reintenta 503 y 429; devuelve la respuesta buena', async () => {
    const { f, base } = armar('segura', [ok(503), ok(429), ok(200)]);
    expect((await f('https://x.test/a')).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('no reintenta errores del cliente (400, 401, 404): repetirlos no arregla nada', async () => {
    for (const status of [400, 401, 404, 409]) {
      const { f, base } = armar('segura', [ok(status)]);
      expect((await f('https://x.test/a')).status).toBe(status);
      expect(base).toHaveBeenCalledTimes(1);
    }
  });
  it('se rinde tras los intentos y lanza el último error', async () => {
    const { f, base } = armar('segura', [falloDeRed('EAI_AGAIN'), falloDeRed('EAI_AGAIN'), falloDeRed('EAI_AGAIN')]);
    await expect(f('https://x.test/a')).rejects.toThrow('fetch failed');
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('si el 503 no se arregla, devuelve el 503 al final (no lanza)', async () => {
    const { f, base } = armar('segura', [ok(503), ok(503), ok(503)]);
    expect((await f('https://x.test/a')).status).toBe(503);
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('no reintenta errores que no son de red', async () => {
    const { f, base } = armar('segura', [new Error('boom')]);
    await expect(f('https://x.test/a')).rejects.toThrow('boom');
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('no reintenta si quien llamó ya canceló', async () => {
    const control = new AbortController();
    control.abort();
    const { f, base } = armar('segura', [falloDeRed('ECONNRESET'), ok()]);
    await expect(f('https://x.test/a', { signal: control.signal })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('cada intento lleva su límite de tiempo y el mismo cuerpo', async () => {
    const { f, base } = armar('segura', [falloDeRed('EAI_AGAIN'), ok()]);
    await f('https://x.test/a', { method: 'POST', body: '{"a":1}' });
    const llamadas = base.mock.calls as unknown as Array<[unknown, RequestInit]>;
    expect(llamadas).toHaveLength(2);
    for (const [, init] of llamadas) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.body).toBe('{"a":1}');
    }
  });
});

describe('política solo-si-no-salio (lo que le llega a una persona o cuesta dinero)', () => {
  it('reintenta cuando el error prueba que no salió (EAI_AGAIN)', async () => {
    const { f, base } = armar('solo-si-no-salio', [falloDeRed('EAI_AGAIN'), falloDeRed('ECONNREFUSED'), ok()]);
    expect((await f('https://x.test/a', { method: 'POST' })).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('NO reintenta un corte a mitad de camino: puede que sí haya llegado', async () => {
    const { f, base } = armar('solo-si-no-salio', [falloDeRed('ECONNRESET'), ok()]);
    await expect(f('https://x.test/a', { method: 'POST' })).rejects.toThrow('fetch failed');
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('NO reintenta si se agotó el tiempo', async () => {
    const { f, base } = armar('solo-si-no-salio', [new DOMException('agotado', 'TimeoutError'), ok()]);
    await expect(f('https://x.test/a', { method: 'POST' })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('NO reintenta un 503: el servidor sí recibió la petición', async () => {
    const { f, base } = armar('solo-si-no-salio', [ok(503), ok(200)]);
    expect((await f('https://x.test/a', { method: 'POST' })).status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });
});
