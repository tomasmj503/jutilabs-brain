import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// PC-13: el mensaje del huésped se guarda ANTES de responder 200 (y si guardar falla, igual se responde 200).
const orden: string[] = [];
vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_WEBHOOK_SECRET: 's3' } }));
let botActivo = true;
const apagado = vi.fn();
vi.mock('../../src/config/cliente.js', () => ({
  cargarClientePorChatwootAccount: async () => ({ id: 'c1', activo: true, botActivo }),
  cargarClientePorSlug: async () => null,
}));
const guardar = vi.fn();
vi.mock('../../src/ingesta/bandeja.js', () => ({ esEntranteGuardable: () => true, guardarEntranteDurable: guardar, recibirConBotApagado: apagado }));
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: async () => { orden.push('procesar'); } }));
vi.mock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: vi.fn() }));
vi.mock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: vi.fn() }));

const { registrarWebhookChatwoot } = await import('../../src/ingesta/webhook.js');
const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');

const cuerpo = {
  event: 'message_created', message_type: 'incoming', id: 77, content: 'ya pagué', account: { id: 1 },
  conversation: { id: 7 }, sender: { type: 'contact', id: 5 },
};

async function enviar(): Promise<number> {
  const app = Fastify();
  await registrarWebhookChatwoot(app);
  const r = await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=s3', payload: cuerpo });
  await esperarEnCurso(2_000);
  await app.close();
  return r.statusCode;
}

beforeEach(() => {
  orden.length = 0;
  botActivo = true;
  apagado.mockReset();
  guardar.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('webhook: bandeja durable', () => {
  it('guarda el mensaje antes de procesarlo y de responder 200', async () => {
    guardar.mockImplementation(async () => { orden.push('guardado'); });
    expect(await enviar()).toBe(200);
    expect(orden).toEqual(['guardado', 'procesar']);
  });

  it('bot apagado: el mensaje nace atendido en el guardado previo y se abre la conversación (no se procesa con el modelo)', async () => {
    botActivo = false;
    guardar.mockResolvedValue(undefined);
    expect(await enviar()).toBe(200);
    expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ botActivo: false }), expect.anything(), true);
    expect(apagado).toHaveBeenCalledTimes(1);
    expect(orden).not.toContain('procesar');
  });

  it('si guardar falla igual responde 200 (Chatwoot no debe reintentar) y el procesamiento sigue', async () => {
    guardar.mockRejectedValue(new Error('Supabase caído'));
    expect(await enviar()).toBe(200);
    expect(orden).toEqual(['procesar']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no se pudo guardar antes del 200'), expect.any(String));
  });

  it('si guardar tarda demasiado no retiene la respuesta más allá del tope', async () => {
    vi.useFakeTimers();
    guardar.mockImplementation(() => new Promise(() => undefined));
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const promesa = app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=s3', payload: cuerpo });
    await vi.advanceTimersByTimeAsync(4_100);
    const r = await promesa;
    expect(r.statusCode).toBe(200);
    vi.useRealTimers();
    await app.close();
  });
});
