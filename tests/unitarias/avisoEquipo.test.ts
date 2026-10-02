import { describe, it, expect, vi, beforeEach } from 'vitest';

const VARIABLES: Record<string, string> = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  REDIS_URL: 'redis://localhost:6379',
  CHATWOOT_BASE_URL: 'https://chat.ejemplo.com/',
  CHATWOOT_WEBHOOK_SECRET: 's',
  N8N_WEBHOOK_AVISOS: 'https://n8n.ejemplo.com/webhook/aviso-equipo',
  N8N_WEBHOOK_SECRET: 'secreto-prueba',
};
for (const [k, v] of Object.entries(VARIABLES)) process.env[k] = v;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { avisarAlCelular, grupoDeAvisos, textoDelAviso } = await import('../../src/salida/avisoEquipo.js');

const cfgCon = { nombre: 'Hostal Prueba', slug: 'pruebas', chatwootAccountId: 2, configExtra: { telegramChatId: '-5136154954' } } as never;
const cfgSin = { nombre: 'Hostal Prueba', slug: 'pruebas', chatwootAccountId: 2, configExtra: {} } as never;

describe('avisarAlCelular', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('cliente sin grupo de avisos: no llama a n8n', async () => {
    await avisarAlCelular(cfgSin, 9, 'nota');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con grupo: manda a n8n la clave, el grupo, la nota y el enlace a la conversación', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await avisarAlCelular(cfgCon, 9, '🤖 Escalado por el bot: no tenía el dato.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(String(url)).toBe(VARIABLES.N8N_WEBHOOK_AVISOS);
    expect(init.method).toBe('POST');
    expect(init.headers['x-jutilabs-secreto']).toBe('secreto-prueba');
    const cuerpo = JSON.parse(String(init.body));
    expect(cuerpo.chatId).toBe('-5136154954');
    expect(cuerpo.texto).toContain('Hostal Prueba');
    expect(cuerpo.texto).toContain('🤖 Escalado por el bot: no tenía el dato.');
    expect(cuerpo.texto).toContain('https://chat.ejemplo.com/app/accounts/2/conversations/9');
  });

  it('si n8n rechaza (403), no lanza y lo deja en el log', async () => {
    fetchMock.mockResolvedValue(new Response('Authorization data is wrong!', { status: 403 }));
    await expect(avisarAlCelular(cfgCon, 9, 'nota')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });

  it('si falla la red, no lanza y lo deja en el log', async () => {
    fetchMock.mockRejectedValue(new Error('caído'));
    await expect(avisarAlCelular(cfgCon, 9, 'nota')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('AVISO AL CELULAR FALLÓ'), 'caído');
  });
});

describe('grupoDeAvisos', () => {
  it('acepta el número del grupo como texto o como número', () => {
    expect(grupoDeAvisos({ configExtra: { telegramChatId: '-5136154954' } } as never)).toBe('-5136154954');
    expect(grupoDeAvisos({ configExtra: { telegramChatId: ' -100123 ' } } as never)).toBe('-100123');
    expect(grupoDeAvisos({ configExtra: { telegramChatId: -5136154954 } } as never)).toBe('-5136154954');
  });

  it('ignora lo que no es un número de grupo', () => {
    for (const v of ['abc', '', null, undefined, 1.5, { id: 1 }, '-12a']) {
      expect(grupoDeAvisos({ configExtra: { telegramChatId: v } } as never)).toBeNull();
    }
    expect(grupoDeAvisos({ configExtra: {} } as never)).toBeNull();
  });
});

describe('textoDelAviso', () => {
  it('corta notas muy largas para no pasar el límite de Telegram', () => {
    const texto = textoDelAviso('Hostal', 'x'.repeat(10_000), 'https://chat/x');
    expect(texto.length).toBeLessThan(4_096);
    expect(texto).toContain('https://chat/x');
  });
});
