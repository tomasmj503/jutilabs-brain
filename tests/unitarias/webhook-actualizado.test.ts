import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_WEBHOOK_SECRET: 's3' } }));
const cargarCliente = vi.fn();
vi.mock('../../src/config/cliente.js', () => ({ cargarClientePorChatwootAccount: cargarCliente }));
const entrante = vi.fn(); const saliente = vi.fn(); const actualizacion = vi.fn();
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: entrante }));
vi.mock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: saliente }));
vi.mock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: actualizacion }));

const { registrarWebhookChatwoot } = await import('../../src/ingesta/webhook.js');
const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');

const cuerpo = (extra: Record<string, unknown>) => ({
  event: 'message_created', message_type: 'incoming', id: 1, content: 'hola', account: { id: 1 }, conversation: { id: 7 }, sender: { type: 'contact', id: 5 }, ...extra,
});
async function enviar(body: unknown, secreto = 's3') {
  const app = Fastify();
  await registrarWebhookChatwoot(app);
  const r = await app.inject({ method: 'POST', url: `/webhook/chatwoot?secret=${secreto}`, payload: body as object });
  await esperarEnCurso(2_000);
  await app.close();
  return r.statusCode;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  cargarCliente.mockResolvedValue({ id: 'c1', activo: true, botActivo: true });
});

describe('webhook: message_updated', () => {
  it('message_updated de un mensaje saliente va a la revisión de fallos (y responde 200)', async () => {
    expect(await enviar(cuerpo({ event: 'message_updated', message_type: 'outgoing' }))).toBe(200);
    expect(actualizacion).toHaveBeenCalledTimes(1);
    expect(entrante).not.toHaveBeenCalled();
    expect(saliente).not.toHaveBeenCalled();
  });
  it('message_created sigue igual: entrante → procesarEntrante, saliente → procesarSaliente', async () => {
    await enviar(cuerpo({}));
    await enviar(cuerpo({ message_type: 'outgoing' }));
    expect(entrante).toHaveBeenCalledTimes(1);
    expect(saliente).toHaveBeenCalledTimes(1);
    expect(actualizacion).not.toHaveBeenCalled();
  });
  it('otros eventos se ignoran', async () => {
    expect(await enviar(cuerpo({ event: 'conversation_updated' }))).toBe(200);
    expect(actualizacion).not.toHaveBeenCalled();
    expect(entrante).not.toHaveBeenCalled();
  });
  it('respeta el interruptor: cliente con el bot apagado no procesa nada', async () => {
    cargarCliente.mockResolvedValue({ id: 'c1', activo: true, botActivo: false });
    await enviar(cuerpo({ event: 'message_updated', message_type: 'outgoing' }));
    expect(actualizacion).not.toHaveBeenCalled();
  });
  it('sin el secreto correcto responde 401 y no procesa', async () => {
    expect(await enviar(cuerpo({ event: 'message_updated', message_type: 'outgoing' }), 'mal')).toBe(401);
    expect(actualizacion).not.toHaveBeenCalled();
  });
  it('un fallo dentro de la revisión no rompe la respuesta ni queda sin manejar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    actualizacion.mockRejectedValueOnce(new Error('boom'));
    expect(await enviar(cuerpo({ event: 'message_updated', message_type: 'outgoing' }))).toBe(200);
  });
});
