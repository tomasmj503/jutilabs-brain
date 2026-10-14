import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// #4 / PC-22 (CON-MULTI): secreto POR CLIENTE, ligado a su account_id, de 32+ caracteres.
const SECRETO_A = 'secreto-del-cliente-a-0123456789-abcdefghij';
const SECRETO_B = 'secreto-del-cliente-b-0123456789-abcdefghij';
const SECRETOS: Record<string, string> = { WEBHOOK_A: SECRETO_A, WEBHOOK_B: SECRETO_B, WEBHOOK_CORTO: 'corto' };

vi.mock('../../src/config/env.js', () => ({
  env: { CHATWOOT_WEBHOOK_SECRET: 'global-vieja' },
  secretoPorRef: (ref: string) => {
    const v = SECRETOS[ref];
    if (!v) throw new Error(`Secreto no configurado: ${ref}`);
    return v;
  },
}));
const cfgA = { id: 'ca', slug: 'a', activo: true, botActivo: true, chatwootAccountId: 1, chatwootWebhookSecretRef: 'WEBHOOK_A' };
const cfgB = { id: 'cb', slug: 'b', activo: true, botActivo: true, chatwootAccountId: 2, chatwootWebhookSecretRef: 'WEBHOOK_B' };
const cfgCorto = { id: 'cc', slug: 'corto', activo: true, botActivo: true, chatwootAccountId: 3, chatwootWebhookSecretRef: 'WEBHOOK_CORTO' };
const cfgSinRef = { id: 'cd', slug: 'sinref', activo: true, botActivo: true, chatwootAccountId: 4, chatwootWebhookSecretRef: null };
const porSlug: Record<string, unknown> = { a: cfgA, b: cfgB, corto: cfgCorto, sinref: cfgSinRef };
const porCuenta: Record<number, unknown> = { 1: cfgA, 2: cfgB, 3: cfgCorto, 4: cfgSinRef };
vi.mock('../../src/config/cliente.js', () => ({
  cargarClientePorSlug: async (slug: string) => porSlug[slug] ?? null,
  cargarClientePorChatwootAccount: async (id: number) => porCuenta[id] ?? null,
}));
const entrante = vi.fn();
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: entrante }));
vi.mock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: vi.fn() }));
vi.mock('../../src/ingesta/bandeja.js', () => ({ esEntranteGuardable: () => false, guardarEntranteDurable: vi.fn() }));
vi.mock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: vi.fn() }));

const { registrarWebhookChatwoot } = await import('../../src/ingesta/webhook.js');
const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');

const cuerpo = (accountId: number) => ({
  event: 'message_created', message_type: 'incoming', id: 9, content: 'hola',
  account: { id: accountId }, conversation: { id: 7 }, sender: { type: 'contact', id: 5 },
});

async function llamar(url: string, accountId: number, encabezados: Record<string, string> = {}) {
  const app = Fastify();
  await registrarWebhookChatwoot(app);
  const r = await app.inject({ method: 'POST', url, payload: cuerpo(accountId), headers: encabezados });
  await esperarEnCurso(2_000);
  await app.close();
  return r.statusCode;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /webhook/chatwoot/:slug', () => {
  it('secreto correcto del cliente y account_id del mismo cliente → 200 y se procesa', async () => {
    expect(await llamar(`/webhook/chatwoot/a?secret=${SECRETO_A}`, 1)).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('también acepta el secreto en el encabezado x-jutilabs-secret', async () => {
    expect(await llamar('/webhook/chatwoot/a', 1, { 'x-jutilabs-secret': SECRETO_A })).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('el secreto del cliente B con la ruta del cliente A → 401 y no se procesa nada', async () => {
    expect(await llamar(`/webhook/chatwoot/a?secret=${SECRETO_B}`, 1)).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('el secreto de B en la ruta de B, pero con el account_id de A en el cuerpo → 401', async () => {
    expect(await llamar(`/webhook/chatwoot/b?secret=${SECRETO_B}`, 1)).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('el secreto global viejo NO sirve en la ruta por cliente', async () => {
    expect(await llamar('/webhook/chatwoot/a?secret=global-vieja', 1)).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('cliente desconocido → 401 (igual que un secreto malo: no revela cuáles existen)', async () => {
    expect(await llamar(`/webhook/chatwoot/nadie?secret=${SECRETO_A}`, 1)).toBe(401);
  });

  it('cliente sin referencia de secreto configurada → 401', async () => {
    expect(await llamar(`/webhook/chatwoot/sinref?secret=${SECRETO_A}`, 4)).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('secreto de menos de 32 caracteres → 401, aunque coincida, y queda en el log', async () => {
    expect(await llamar('/webhook/chatwoot/corto?secret=corto', 3)).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('32'));
  });

  it('sin secreto → 401', async () => {
    expect(await llamar('/webhook/chatwoot/a', 1)).toBe(401);
  });

  it('la ruta vieja sigue funcionando con el secreto global (temporal) y avisa que es obsoleta', async () => {
    expect(await llamar('/webhook/chatwoot?secret=global-vieja', 1)).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OBSOLETA'));
  });

  it('la ruta vieja rechaza un secreto malo', async () => {
    expect(await llamar('/webhook/chatwoot?secret=otro', 1)).toBe(401);
  });
});
