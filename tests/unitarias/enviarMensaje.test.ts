import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_BASE_URL: 'https://chat.test' }, secretoPorRef: () => 'token' }));
// Sin esperas reales: los reintentos y la pausa antes de verificar corren al instante.
vi.mock('../../src/red/reintento.js', async (original) => {
  const m = await original<typeof import('../../src/red/reintento.js')>();
  return { ...m, dormir: async () => undefined, crearFetch: (op: Parameters<typeof m.crearFetch>[0]) => m.crearFetch({ ...op, esperar: async () => undefined }) };
});

const { enviarMensaje } = await import('../../src/salida/chatwoot.js');
const { EnvioIncierto, ErrorChatwoot } = await import('../../src/salida/errores.js');

const cfg = { id: 'c1', chatwootAccountId: 1, chatwootTokenRef: 'T' } as never;
const TEXTO = 'Hola, ¿en qué te ayudo?';

const falloDeRed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const creado = (id: number) => json({ id });
const ahoraSeg = () => Math.floor(Date.now() / 1000);
const saliente = (id: number, content: string, extra: Record<string, unknown> = {}) =>
  ({ id, content, message_type: 1, private: false, created_at: ahoraSeg() + 1, ...extra });
const lista = (mensajes: unknown[]) => json({ meta: {}, payload: mensajes });

let respuestas: Array<Response | Error>;
let llamadas: Array<{ metodo: string; url: string }>;

beforeEach(() => {
  respuestas = [];
  llamadas = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ metodo: init?.method ?? 'GET', url });
    const siguiente = respuestas.shift();
    if (siguiente === undefined) throw new Error('la prueba se quedó sin respuestas');
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const envios = () => llamadas.filter((l) => l.metodo === 'POST').length;
const verificaciones = () => llamadas.filter((l) => l.metodo === 'GET').length;

describe('enviarMensaje: camino normal', () => {
  it('envía una vez y devuelve el id', async () => {
    respuestas = [creado(77)];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(77);
    expect(envios()).toBe(1);
    expect(verificaciones()).toBe(0);
  });
});

describe('enviarMensaje: cuando la petición nunca salió', () => {
  it('reintenta solo ante EAI_AGAIN y manda UN mensaje', async () => {
    respuestas = [falloDeRed('EAI_AGAIN'), falloDeRed('EAI_AGAIN'), creado(78)];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(78);
    expect(envios()).toBe(3); // 2 fallidos que nunca salieron + 1 real
    expect(verificaciones()).toBe(0);
  });
  it('si nunca se logra conectar, lanza el error normal (no "incierto") y no verifica', async () => {
    respuestas = [falloDeRed('EAI_AGAIN'), falloDeRed('EAI_AGAIN'), falloDeRed('EAI_AGAIN')];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(EnvioIncierto);
    expect(verificaciones()).toBe(0);
  });
  it('un 400 de Chatwoot no se reintenta ni se verifica', async () => {
    respuestas = [json({ error: 'malo' }, 400)];
    await expect(enviarMensaje(cfg, 5, TEXTO)).rejects.toBeInstanceOf(ErrorChatwoot);
    expect(envios()).toBe(1);
    expect(verificaciones()).toBe(0);
  });
});

describe('enviarMensaje: cuando no se sabe si salió', () => {
  it('corte a mitad de camino + el mensaje ya está en Chatwoot: NO reenvía y devuelve ese id', async () => {
    respuestas = [falloDeRed('ECONNRESET'), lista([saliente(90, TEXTO)])];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(90);
    expect(envios()).toBe(1);
    expect(verificaciones()).toBe(1);
  });
  it('un 503 + el mensaje ya está: NO reenvía', async () => {
    respuestas = [json({}, 503), lista([saliente(91, `  ${TEXTO}\n`)])];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(91);
    expect(envios()).toBe(1);
  });
  it('respuesta 200 sin id + el mensaje ya está: NO reenvía', async () => {
    respuestas = [json({}), lista([saliente(92, TEXTO)])];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(92);
    expect(envios()).toBe(1);
  });
  it('corte + Chatwoot confirma que NO existe: reenvía UNA vez', async () => {
    respuestas = [falloDeRed('ECONNRESET'), lista([]), creado(93)];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(93);
    expect(envios()).toBe(2);
  });
  it('un mensaje viejo (anterior al intento) no cuenta como enviado', async () => {
    const viejo = saliente(50, TEXTO, { created_at: ahoraSeg() - 3600 });
    respuestas = [falloDeRed('ECONNRESET'), lista([viejo]), creado(94)];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(94);
    expect(envios()).toBe(2);
  });
  it('las notas privadas y los mensajes del huésped no cuentan', async () => {
    const nota = saliente(60, TEXTO, { private: true });
    const entrante = saliente(61, TEXTO, { message_type: 0 });
    respuestas = [falloDeRed('ECONNRESET'), lista([nota, entrante]), creado(95)];
    expect(await enviarMensaje(cfg, 5, TEXTO)).toBe(95);
  });
  it('si tras reenviar vuelve a fallar y Chatwoot confirma que no existe: error normal, máximo 2 envíos', async () => {
    respuestas = [falloDeRed('ECONNRESET'), lista([]), falloDeRed('ECONNRESET'), lista([])];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(EnvioIncierto);
    expect(envios()).toBe(2);
  });
});

describe('enviarMensaje: ante la duda NO reenvía (lanza EnvioIncierto)', () => {
  it('no se pudo verificar (la red falla)', async () => {
    respuestas = [falloDeRed('ECONNRESET'), falloDeRed('ECONNRESET'), falloDeRed('ECONNRESET'), falloDeRed('ECONNRESET')];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(EnvioIncierto);
    expect(e.resultado).toBe('no-se');
    expect(envios()).toBe(1);
  });
  it('la respuesta de verificación no tiene la forma esperada', async () => {
    respuestas = [falloDeRed('ECONNRESET'), json({ inesperado: true })];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(EnvioIncierto);
    expect(envios()).toBe(1);
  });
  it('la verificación responde error HTTP', async () => {
    respuestas = [falloDeRed('ECONNRESET'), json({}, 500), json({}, 500), json({}, 500)];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(EnvioIncierto);
    expect(envios()).toBe(1);
  });
  it('apareció otro mensaje saliente distinto (dudoso): no reenvía', async () => {
    respuestas = [falloDeRed('ECONNRESET'), lista([saliente(70, 'Otro texto de una persona')])];
    const e = await enviarMensaje(cfg, 5, TEXTO).catch((x) => x);
    expect(e).toBeInstanceOf(EnvioIncierto);
    expect(e.resultado).toBe('dudoso');
    expect(envios()).toBe(1);
  });
});
