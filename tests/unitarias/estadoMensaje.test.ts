import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_BASE_URL: 'https://chat.test' }, secretoPorRef: () => 'token' }));
vi.mock('../../src/red/reintento.js', async (original) => {
  const m = await original<typeof import('../../src/red/reintento.js')>();
  return { ...m, dormir: async () => undefined, crearFetch: (op: Parameters<typeof m.crearFetch>[0]) => m.crearFetch({ ...op, esperar: async () => undefined }) };
});
const { consultarEstadoMensaje } = await import('../../src/salida/chatwoot.js');

const cfg = { id: 'c1', chatwootAccountId: 1, chatwootTokenRef: 'T' } as never;
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const lista = (mensajes: unknown[]) => json({ meta: {}, payload: mensajes });
const msg = (id: number, extra: Record<string, unknown> = {}) => ({ id, content: 'Hola', message_type: 1, private: false, status: 'sent', ...extra });

let respuestas: Array<Response | Error>;
let urls: string[];
beforeEach(() => {
  respuestas = []; urls = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const r = respuestas.shift();
    if (r === undefined) throw new Error('sin respuestas');
    if (r instanceof Error) throw r;
    return r;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('consultarEstadoMensaje', () => {
  it('lee la lista de mensajes de la conversación con GET', async () => {
    respuestas = [lista([msg(10)])];
    await consultarEstadoMensaje(cfg, 5, 10);
    expect(urls).toEqual(['https://chat.test/api/v1/accounts/1/conversations/5/messages']);
  });
  it.each(['sent', 'delivered', 'read'])('estado %s = todo bien', async (status) => {
    respuestas = [lista([msg(10, { status })])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'ok' });
  });
  it('failed: devuelve el motivo de Meta y el texto', async () => {
    respuestas = [lista([msg(9), msg(10, { status: 'failed', content: 'Hola, ¿qué tal?', content_attributes: { external_error: '131047: Re-engagement message' } })])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'fallido', error: '131047: Re-engagement message', contenido: 'Hola, ¿qué tal?' });
  });
  it('failed sin motivo: error null', async () => {
    respuestas = [lista([msg(10, { status: 'failed' })])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toMatchObject({ estado: 'fallido', error: null });
  });
  it('el mensaje no está en la lista: no-encontrado', async () => {
    respuestas = [lista([msg(1), msg(2)])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'no-encontrado' });
  });
  it('mensaje sin estado (null): no se afirma nada', async () => {
    respuestas = [lista([msg(10, { status: null })])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'no-se' });
  });
  it('Chatwoot responde error, o algo que no es una lista: no-se', async () => {
    respuestas = [json({ error: 'x' }, 401)];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'no-se' });
    respuestas = [json({ payload: 'raro' })];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'no-se' });
  });
  it('falla de red: reintenta (lectura segura) y si sigue fallando, no-se', async () => {
    const caida = Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
    respuestas = [caida, caida, caida];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toEqual({ estado: 'no-se' });
    expect(urls.length).toBe(3);
  });
  it('falla de red pasajera y luego funciona', async () => {
    const caida = Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
    respuestas = [caida, lista([msg(10, { status: 'failed' })])];
    expect(await consultarEstadoMensaje(cfg, 5, 10)).toMatchObject({ estado: 'fallido' });
  });
});
