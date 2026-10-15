import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// D-08: el chat vuelve a Max SOLO con la nota privada «#max» de una persona. Nunca por tiempo, ni al resolver,
// ni al desasignar, ni con un mensaje público, ni con una nota del propio bot.
const reactivarBot = vi.fn();
const limpiarAviso = vi.fn();
const idUsuarioBot = vi.fn();
const nota = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: { CHATWOOT_WEBHOOK_SECRET: 's3' }, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/conversacion/estado.js', () => ({ reactivarBot, pausarBot: vi.fn() }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ limpiarAvisoPendiente: limpiarAviso, registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/salida/chatwoot.js', () => ({ idUsuarioBot, enviarNotaPrivada: nota, enviarMensaje: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));
vi.mock('../../src/ingesta/dedup.js', () => ({ yaProcesado: vi.fn(async () => false) }));
vi.mock('../../src/ingesta/atenderTurno.js', () => ({ avisarFallo: () => () => undefined }));

const { esComandoLiberar, procesarLiberacion } = await import('../../src/ingesta/liberacion.js');
const { yaProcesado } = await import('../../src/ingesta/dedup.js');

const cfg = { id: 'c1', idiomaDefault: 'es' } as never;
const aviso = (extra: Record<string, unknown> = {}) => ({
  evento: 'message_created', direccion: 'saliente', privado: true, messageId: 30, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'user', remitenteId: 42, contenido: '#max',
  estado: null, errorExterno: null, adjuntos: [], ...extra,
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  idUsuarioBot.mockResolvedValue(1);
  reactivarBot.mockResolvedValue(undefined);
  limpiarAviso.mockResolvedValue(undefined);
  nota.mockResolvedValue(undefined);
  vi.mocked(yaProcesado).mockResolvedValue(false);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('esComandoLiberar', () => {
  it.each([['#max'], ['#MAX'], ['  #Max  '], ['#max gracias'], ['#max.']])('«%s» sí', (c) => {
    expect(esComandoLiberar(aviso({ contenido: c }))).toBe(true);
  });
  it.each([['max'], ['#maxima'], ['hola #max'], ['#maxi'], ['']])('«%s» no', (c) => {
    expect(esComandoLiberar(aviso({ contenido: c }))).toBe(false);
  });
  it('un mensaje PÚBLICO con #max no libera (solo la nota privada)', () => {
    expect(esComandoLiberar(aviso({ privado: false }))).toBe(false);
  });
  it('un mensaje entrante del huésped con #max no libera', () => {
    expect(esComandoLiberar(aviso({ direccion: 'entrante', privado: false }))).toBe(false);
  });
});

describe('procesarLiberacion', () => {
  it('una persona del equipo escribe «#max» en una nota privada → el bot vuelve a estar activo', async () => {
    await procesarLiberacion(cfg, aviso());
    expect(reactivarBot).toHaveBeenCalledWith(cfg, 7);
    expect(limpiarAviso).toHaveBeenCalledWith(cfg, 7); // un aviso viejo pendiente no la vuelve a pausar
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('Max'));
  });

  it('la nota que deja el PROPIO bot (p. ej. citando el mensaje del huésped) no libera', async () => {
    await procesarLiberacion(cfg, aviso({ remitenteId: 1 }));
    expect(reactivarBot).not.toHaveBeenCalled();
  });

  it('un remitente que no es usuario de Chatwoot no libera', async () => {
    await procesarLiberacion(cfg, aviso({ remitenteTipo: 'contact' }));
    expect(reactivarBot).not.toHaveBeenCalled();
  });

  it('si no se puede saber quién es el bot, no libera por si acaso (y no lanza)', async () => {
    idUsuarioBot.mockRejectedValue(new Error('Chatwoot caído'));
    await expect(procesarLiberacion(cfg, aviso())).resolves.toBeUndefined();
    expect(reactivarBot).not.toHaveBeenCalled();
  });

  it('el mismo aviso repetido por Chatwoot libera una sola vez', async () => {
    vi.mocked(yaProcesado).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await procesarLiberacion(cfg, aviso());
    await procesarLiberacion(cfg, aviso());
    expect(reactivarBot).toHaveBeenCalledTimes(1);
  });

  it('si reactivar falla, lo deja claro en una nota al equipo y no lanza', async () => {
    reactivarBot.mockRejectedValue(new Error('Supabase caído'));
    await expect(procesarLiberacion(cfg, aviso())).resolves.toBeUndefined();
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO se pudo'));
  });
});

describe('webhook: #max', () => {
  it('la nota privada #max va a la liberación y NO a la pausa por «respondió una persona»', async () => {
    vi.resetModules();
    const liberar = vi.fn();
    const saliente = vi.fn();
    vi.doMock('../../src/config/cliente.js', () => ({
      cargarClientePorChatwootAccount: async () => ({ id: 'c1', activo: true, botActivo: true }),
      cargarClientePorSlug: async () => null,
    }));
    vi.doMock('../../src/ingesta/bandeja.js', () => ({ esEntranteGuardable: () => false, guardarEntranteDurable: vi.fn(), recibirConBotApagado: vi.fn() }));
    vi.doMock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: vi.fn() }));
    vi.doMock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: saliente }));
    vi.doMock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: vi.fn() }));
    vi.doMock('../../src/ingesta/liberacion.js', () => ({
      esComandoLiberar: (a: { privado: boolean; contenido: string }) => a.privado && /^\s*#max\b/i.test(a.contenido),
      procesarLiberacion: liberar,
    }));
    const { registrarWebhookChatwoot } = await import('../../src/ingesta/webhook.js');
    const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const cuerpo = (extra: object) => ({
      event: 'message_created', message_type: 'outgoing', id: 30, content: '#max', account: { id: 1 }, conversation: { id: 7 },
      sender: { type: 'user', id: 42 }, ...extra,
    });
    await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=s3', payload: cuerpo({ private: true }) });
    await esperarEnCurso(2_000);
    expect(liberar).toHaveBeenCalledTimes(1);
    expect(saliente).not.toHaveBeenCalled();
    await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=s3', payload: cuerpo({ private: false, id: 31 }) });
    await esperarEnCurso(2_000);
    expect(saliente).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
