import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/red/reintento.js', () => ({
  crearFetch: () => (...args: unknown[]) => fetchMock(...args),
  dormir: vi.fn(),
  esFalloDeRed: () => false,
  clasificarFalloDeRed: () => 'no-salio',
}));
vi.mock('../../src/config/env.js', () => ({
  env: { CHATWOOT_BASE_URL: 'https://chat.ejemplo.com/' },
  secretoPorRef: (ref: string) => `token-de-${ref}`,
}));

const { marcarAbierta } = await import('../../src/salida/chatwoot.js');

// En Chatwoot 4.17.0 el Agent Bot es un asignado aparte (meta.assignee_type 'AgentBot') y su id es de otra tabla que los
// usuarios: aquí el id del bot y el de la persona son IGUALES a propósito, para que solo el tipo los distinga.
const BOT = 42;
const PERSONA = 42;
const cfg = { id: 'c1', slug: 'm', chatwootAccountId: 1, chatwootTokenRef: 'X', chatwootBotTokenRef: 'B' } as never;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

/** Chatwoot simulado: quién tiene asignada la conversación (null = nadie) y qué fallos hay. */
function chatwoot(opciones: { asignado: 'bot' | 'persona' | null | 'sin-meta'; falla?: 'toggle' | 'lectura' | 'asignar' }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/toggle_status')) return opciones.falla === 'toggle' ? new Response('error', { status: 500 }) : json({});
    if (url.endsWith('/assignments')) return opciones.falla === 'asignar' ? new Response('no', { status: 422 }) : json({});
    if (/\/conversations\/7$/.test(url)) {
      if (opciones.falla === 'lectura') return new Response('boom', { status: 500 });
      if (opciones.asignado === 'sin-meta') return json({ id: 7 });
      // Sin asignado, Chatwoot ni siquiera manda la clave `assignee`.
      if (opciones.asignado === null) return json({ id: 7, meta: { sender: { id: 5 } } });
      return json({ id: 7, meta: opciones.asignado === 'bot'
        ? { assignee: { id: BOT, name: 'Max', bot_type: 'webhook' }, assignee_type: 'AgentBot' }
        : { assignee: { id: PERSONA, name: 'Andrea' }, assignee_type: 'User' } });
    }
    throw new Error(`URL inesperada ${url}`);
  });
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const llamoAsignar = () => urls().some((u) => u.endsWith('/assignments'));
const asignarCuerpo = () => {
  const i = urls().findIndex((u) => u.endsWith('/assignments'));
  return JSON.parse((fetchMock.mock.calls[i]?.[1] as { body: string }).body) as unknown;
};

describe('marcarAbierta (modo Agent Bot)', () => {
  // Con llaves: vitest toma como «limpieza» cualquier función que devuelva un beforeEach (y el mock lo es).
  beforeEach(() => { fetchMock.mockReset(); });

  it('conversación asignada al propio bot: la abre y la desasigna (assignee_id 0), en ese orden', async () => {
    chatwoot({ asignado: 'bot' });
    await marcarAbierta(cfg, 7);
    const u = urls();
    expect(u[0]).toBe('https://chat.ejemplo.com/api/v1/accounts/1/conversations/7/toggle_status');
    expect(u.at(-1)).toBe('https://chat.ejemplo.com/api/v1/accounts/1/conversations/7/assignments');
    expect(asignarCuerpo()).toEqual({ assignee_id: 0 });
  });

  // #12 / PC-20 (UNI-ABRIR): escalar NUNCA le quita la conversación a una persona.
  it('conversación asignada a una PERSONA: la abre pero NO la desasigna', async () => {
    chatwoot({ asignado: 'persona' });
    await marcarAbierta(cfg, 7);
    expect(urls()[0]).toContain('/toggle_status');
    expect(llamoAsignar()).toBe(false);
  });

  it('sin asignado: la abre y no hay nada que desasignar', async () => {
    chatwoot({ asignado: null });
    await marcarAbierta(cfg, 7);
    expect(llamoAsignar()).toBe(false);
  });

  it('si no se puede saber quién la tiene (lectura falla o respuesta sin meta): NO desasigna (falla segura) y no lanza', async () => {
    chatwoot({ asignado: 'bot', falla: 'lectura' });
    await expect(marcarAbierta(cfg, 7)).resolves.toBeUndefined();
    expect(llamoAsignar()).toBe(false);
    fetchMock.mockReset();
    chatwoot({ asignado: 'sin-meta' });
    await marcarAbierta(cfg, 7);
    expect(llamoAsignar()).toBe(false);
  });

  it('usa el encabezado con guiones (Caddy descarta los de guion bajo)', async () => {
    chatwoot({ asignado: 'bot' });
    await marcarAbierta(cfg, 7);
    const i = urls().findIndex((u) => u.endsWith('/assignments'));
    expect((fetchMock.mock.calls[i]?.[1] as { headers: Record<string, string> }).headers['api-access-token']).toBe('token-de-B');
  });

  it('las escrituras (toggle_status, assignments) usan el token del Agent Bot; leer la conversación, el de usuario', async () => {
    chatwoot({ asignado: 'bot' });
    await marcarAbierta(cfg, 7);
    const token = (u: string) => (fetchMock.mock.calls[urls().findIndex((x) => x.endsWith(u))]?.[1] as { headers: Record<string, string> }).headers['api-access-token'];
    expect(token('/toggle_status')).toBe('token-de-B');
    expect(token('/assignments')).toBe('token-de-B');
    expect(token('/conversations/7')).toBe('token-de-X');
  });

  it('el bot cuenta como asignado por su TIPO, no por su id: un usuario con el mismo id no es el bot', async () => {
    chatwoot({ asignado: 'persona' }); // id 42 igual al del bot
    await marcarAbierta(cfg, 7);
    expect(llamoAsignar()).toBe(false);
  });

  it('no consulta /api/v1/profile (el token del Agent Bot no puede)', async () => {
    chatwoot({ asignado: 'bot' });
    await marcarAbierta(cfg, 7);
    expect(urls().some((u) => u.includes('/profile'))).toBe(false);
  });

  it('si abrir falla, lanza y NO intenta desasignar', async () => {
    chatwoot({ asignado: 'bot', falla: 'toggle' });
    await expect(marcarAbierta(cfg, 7)).rejects.toThrow('toggle_status');
    expect(llamoAsignar()).toBe(false);
  });

  it('si desasignar al bot falla, lanza (para que el escalamiento reintente)', async () => {
    chatwoot({ asignado: 'bot', falla: 'asignar' });
    await expect(marcarAbierta(cfg, 7)).rejects.toThrow('assignments');
  });
});
