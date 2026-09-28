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
  secretoPorRef: () => 'token-de-prueba',
}));

const { marcarAbierta } = await import('../../src/salida/chatwoot.js');

const cfg = { id: 'c1', chatwootAccountId: 1, chatwootTokenRef: 'X' } as never;
const ok = () => new Response('{}', { status: 200 });
const llamada = (n: number) => {
  const [url, init] = fetchMock.mock.calls[n] as [string, { body: string; headers: Record<string, string> }];
  return { url, cuerpo: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers };
};

describe('marcarAbierta', () => {
  beforeEach(() => fetchMock.mockReset());

  it('abre la conversación y DESPUÉS la desasigna (assignee_id 0), en ese orden', async () => {
    fetchMock.mockResolvedValue(ok());
    await marcarAbierta(cfg, 7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(llamada(0).url).toBe('https://chat.ejemplo.com/api/v1/accounts/1/conversations/7/toggle_status');
    expect(llamada(0).cuerpo).toEqual({ status: 'open' });
    expect(llamada(1).url).toBe('https://chat.ejemplo.com/api/v1/accounts/1/conversations/7/assignments');
    expect(llamada(1).cuerpo).toEqual({ assignee_id: 0 });
  });

  it('usa el encabezado con guiones (Caddy descarta los de guion bajo)', async () => {
    fetchMock.mockResolvedValue(ok());
    await marcarAbierta(cfg, 7);
    expect(llamada(1).headers['api-access-token']).toBe('token-de-prueba');
  });

  it('si abrir falla, lanza y NO intenta desasignar', async () => {
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 500 }));
    await expect(marcarAbierta(cfg, 7)).rejects.toThrow('toggle_status');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si desasignar falla, lanza (para que el escalamiento reintente)', async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('no', { status: 422 }));
    await expect(marcarAbierta(cfg, 7)).rejects.toThrow('assignments');
  });
});
