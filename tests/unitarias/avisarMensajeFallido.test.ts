import { describe, it, expect, vi, beforeEach } from 'vitest';

const enviarNotaPrivadaMock = vi.fn();
const marcarAbiertaMock = vi.fn();
const enviarMensajeMock = vi.fn();
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: vi.fn() }));
const avisarAlCelularMock = vi.fn();
const registrarAvisoPendienteMock = vi.fn();
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: avisarAlCelularMock }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: registrarAvisoPendienteMock }));

const { avisarMensajeFallido } = await import('../../src/salida/escalamiento.js');
const cfg = { id: 'c1' } as never;
const nota = () => String(enviarNotaPrivadaMock.mock.calls[0]?.[2]);

beforeEach(() => {
  vi.clearAllMocks();
  enviarNotaPrivadaMock.mockResolvedValue(undefined);
  marcarAbiertaMock.mockResolvedValue(undefined);
  avisarAlCelularMock.mockResolvedValue('enviado');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('avisarMensajeFallido', () => {
  it('deja nota privada con el motivo de Meta y el texto, y abre la conversación', async () => {
    await avisarMensajeFallido(cfg, 7, { error: '131047: Re-engagement message', contenido: 'Hola, ¿en qué te ayudo?' });
    expect(enviarNotaPrivadaMock).toHaveBeenCalledTimes(1);
    expect(nota()).toContain('131047: Re-engagement message');
    expect(nota()).toContain('Hola, ¿en qué te ayudo?');
    expect(nota()).toContain('Reintentar'); // advierte del botón con el bug reportado
    expect(marcarAbiertaMock).toHaveBeenCalledWith(cfg, 7);
  });
  it('NO le manda nada al huésped (sin reenvío automático)', async () => {
    await avisarMensajeFallido(cfg, 7, { error: null, contenido: 'x' });
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(nota()).toContain('Meta no informó el motivo');
  });
  it('si la nota falla, lanza el error (para que se pueda reintentar) y no abre la conversación', async () => {
    enviarNotaPrivadaMock.mockRejectedValueOnce(new Error('Chatwoot caído'));
    await expect(avisarMensajeFallido(cfg, 7, { error: null, contenido: 'x' })).rejects.toThrow('Chatwoot caído');
    expect(marcarAbiertaMock).not.toHaveBeenCalled();
  });
  it('si abrir la conversación falla, la nota ya quedó y no se lanza error', async () => {
    marcarAbiertaMock.mockRejectedValue(new Error('x'));
    await expect(avisarMensajeFallido(cfg, 7, { error: null, contenido: 'x' })).resolves.toBeUndefined();
  });
  it('recorta un texto larguísimo', async () => {
    await avisarMensajeFallido(cfg, 7, { error: null, contenido: 'a'.repeat(1000) });
    expect(nota().length).toBeLessThan(900);
  });
  it('PC-15: si la nota quedó pero el aviso al celular falló, queda pendiente (sin pausar ni escribirle al huésped)', async () => {
    avisarAlCelularMock.mockResolvedValue('fallido');
    await avisarMensajeFallido(cfg, 7, { error: null, contenido: 'x' });
    expect(registrarAvisoPendienteMock).toHaveBeenCalledWith(cfg, 7, expect.objectContaining({ pausar: false, notaCreada: true, motivo: 'mensaje_fallido' }));
    expect(enviarMensajeMock).not.toHaveBeenCalled();
  });
  it('PC-15: con el aviso confirmado no deja nada pendiente', async () => {
    await avisarMensajeFallido(cfg, 7, { error: null, contenido: 'x' });
    expect(registrarAvisoPendienteMock).not.toHaveBeenCalled();
  });
  it('#12: si lo escribió una PERSONA, la nota lo dice, NO abre la conversación (no se la toca) y no ofrece «Reintentar»', async () => {
    await avisarMensajeFallido(cfg, 7, { error: '131047: Re-engagement message', contenido: 'Hola', deLaPersona: true });
    expect(nota()).toContain('persona del equipo');
    expect(nota()).toContain('131047: Re-engagement message');
    expect(marcarAbiertaMock).not.toHaveBeenCalled();
    expect(enviarMensajeMock).not.toHaveBeenCalled();
  });
});
