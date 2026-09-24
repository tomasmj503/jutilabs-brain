import { describe, it, expect, vi, beforeEach } from 'vitest';
import { almacen, limpiar } from './redisFalso.js';

vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalso.js')).redisFalso }));
const consultar = vi.fn();
const avisar = vi.fn();
vi.mock('../../src/salida/chatwoot.js', () => ({ consultarEstadoMensaje: consultar }));
vi.mock('../../src/salida/escalamiento.js', () => ({ avisarMensajeFallido: avisar }));

const { procesarActualizacion } = await import('../../src/ingesta/revisarFallo.js');

const cfg = { id: 'c1' } as never;
const aviso = (extra: Record<string, unknown> = {}) => ({
  evento: 'message_updated', direccion: 'saliente', privado: false, messageId: 900, conversationId: 5, accountId: 1,
  contactId: 1, telefono: '573000000000', remitenteTipo: 'user', remitenteId: 2, contenido: 'Hola',
  estado: null, errorExterno: null, ...extra,
}) as never;
const fallido = { estado: 'fallido', error: '131047: Re-engagement message', contenido: 'Hola' };

beforeEach(() => {
  limpiar(); consultar.mockReset(); avisar.mockReset(); avisar.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('procesarActualizacion: lo que NO se revisa', () => {
  it('ignora notas privadas, mensajes entrantes y avisos sin id', async () => {
    await procesarActualizacion(cfg, aviso({ privado: true }));
    await procesarActualizacion(cfg, aviso({ direccion: 'entrante' }));
    await procesarActualizacion(cfg, aviso({ messageId: null }));
    expect(consultar).not.toHaveBeenCalled();
  });
  it('si el aviso ya dice "delivered" o "read" no pregunta a la API', async () => {
    await procesarActualizacion(cfg, aviso({ estado: 'delivered' }));
    await procesarActualizacion(cfg, aviso({ estado: 'read' }));
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe('procesarActualizacion: verifica con la API (no confía en el aviso)', () => {
  it('aviso sin estado (como en Chatwoot 4.17.0): pregunta a la API y, si todo va bien, no avisa', async () => {
    consultar.mockResolvedValue({ estado: 'ok' });
    await procesarActualizacion(cfg, aviso());
    expect(consultar).toHaveBeenCalledWith(cfg, 5, 900);
    expect(avisar).not.toHaveBeenCalled();
  });
  it('el aviso dice "failed" pero la API dice que no: no se avisa', async () => {
    consultar.mockResolvedValue({ estado: 'ok' });
    await procesarActualizacion(cfg, aviso({ estado: 'failed' }));
    expect(avisar).not.toHaveBeenCalled();
  });
  it('la API confirma el fallo: avisa al equipo con el motivo de Meta', async () => {
    consultar.mockResolvedValue(fallido);
    await procesarActualizacion(cfg, aviso());
    expect(avisar).toHaveBeenCalledWith(cfg, 5, { error: '131047: Re-engagement message', contenido: 'Hola' });
  });
  it('avisa UNA sola vez por mensaje aunque lleguen varios avisos', async () => {
    consultar.mockResolvedValue(fallido);
    await procesarActualizacion(cfg, aviso());
    await procesarActualizacion(cfg, aviso({ estado: 'failed' }));
    await procesarActualizacion(cfg, aviso());
    expect(avisar).toHaveBeenCalledTimes(1);
  });
  it('mensajes distintos avisan por separado', async () => {
    consultar.mockResolvedValue(fallido);
    await procesarActualizacion(cfg, aviso({ messageId: 901 }));
    await procesarActualizacion(cfg, aviso({ messageId: 902 }));
    expect(avisar).toHaveBeenCalledTimes(2);
  });
  it('recuerda el mensaje 30 días', async () => {
    consultar.mockResolvedValue(fallido);
    await procesarActualizacion(cfg, aviso());
    expect(almacen.has('fallo:c1:900')).toBe(true);
  });
});

describe('procesarActualizacion: cuando no se puede saber o no se puede avisar', () => {
  it('si la API no responde bien, no avisa (y si el aviso decía "failed", lo deja en el registro)', async () => {
    consultar.mockResolvedValue({ estado: 'no-se' });
    await procesarActualizacion(cfg, aviso({ estado: 'failed' }));
    expect(avisar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MENSAJE FALLIDO SIN VERIFICAR'));
  });
  it('mensaje que no está entre los últimos de la conversación: no avisa', async () => {
    consultar.mockResolvedValue({ estado: 'no-encontrado' });
    await procesarActualizacion(cfg, aviso());
    expect(avisar).not.toHaveBeenCalled();
  });
  it('si la nota al equipo falla, se deshace la marca y un aviso posterior lo intenta de nuevo', async () => {
    consultar.mockResolvedValue(fallido);
    avisar.mockRejectedValueOnce(new Error('Chatwoot caído'));
    await procesarActualizacion(cfg, aviso());
    expect(almacen.has('fallo:c1:900')).toBe(false);
    await procesarActualizacion(cfg, aviso());
    expect(avisar).toHaveBeenCalledTimes(2);
    expect(almacen.has('fallo:c1:900')).toBe(true);
  });
});
