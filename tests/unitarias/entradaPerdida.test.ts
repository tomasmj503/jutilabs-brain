import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// #19 (UNI-PERDIDA): un fallo al procesar un mensaje del huésped deja nota privada + aviso, no solo un log.
const alertar = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_WEBHOOK_SECRET: 's3' } }));
vi.mock('../../src/config/cliente.js', () => ({
  cargarClientePorChatwootAccount: async () => ({ id: 'c1', activo: true, botActivo: true }),
  cargarClientePorSlug: async () => null,
}));
vi.mock('../../src/salida/alertaEquipo.js', () => ({ alertarAlEquipo: alertar }));
vi.mock('../../src/ingesta/bandeja.js', () => ({ esEntranteGuardable: () => false, guardarEntranteDurable: vi.fn() }));
const entrante = vi.fn();
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: entrante }));
vi.mock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: vi.fn() }));
vi.mock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: vi.fn() }));

const { registrarWebhookChatwoot } = await import('../../src/ingesta/webhook.js');
const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');

const cuerpo = {
  event: 'message_created', message_type: 'incoming', id: 77, content: 'ya pagué 4111 1111 1111 1111', account: { id: 1 },
  conversation: { id: 7 }, sender: { type: 'contact', id: 5 },
};

beforeEach(() => {
  vi.clearAllMocks();
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function enviar(payload: object = cuerpo): Promise<number> {
  const app = Fastify();
  await registrarWebhookChatwoot(app);
  const r = await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=s3', payload });
  await esperarEnCurso(2_000);
  await app.close();
  return r.statusCode;
}

describe('webhook: fallo al procesar un mensaje del huésped', () => {
  it('responde 200, y deja nota + aviso al equipo (con el texto enmascarado)', async () => {
    entrante.mockRejectedValue(new Error('Supabase caído'));
    expect(await enviar()).toBe(200);
    expect(alertar).toHaveBeenCalledTimes(1);
    const [, conversacion, nota, opciones] = alertar.mock.calls[0] as [unknown, number, string, { abrir?: boolean }];
    expect(conversacion).toBe(7);
    expect(nota).toContain('Supabase caído');
    expect(nota).toContain('ya pagué');
    expect(nota).not.toMatch(/4111/);
    expect(opciones).toEqual({ abrir: true });
  });

  it('si todo sale bien no alerta', async () => {
    entrante.mockResolvedValue(undefined);
    await enviar();
    expect(alertar).not.toHaveBeenCalled();
  });

  it('un mensaje saliente (persona) que falla no genera alerta de «huésped sin atender»', async () => {
    entrante.mockRejectedValue(new Error('x'));
    await enviar({ ...cuerpo, message_type: 'outgoing' });
    expect(alertar).not.toHaveBeenCalled();
  });
});
