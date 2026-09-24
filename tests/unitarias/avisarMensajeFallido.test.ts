import { describe, it, expect, vi, beforeEach } from 'vitest';

const enviarNotaPrivadaMock = vi.fn();
const marcarAbiertaMock = vi.fn();
const enviarMensajeMock = vi.fn();
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: vi.fn() }));

const { avisarMensajeFallido } = await import('../../src/salida/escalamiento.js');
const cfg = { id: 'c1' } as never;
const nota = () => String(enviarNotaPrivadaMock.mock.calls[0]?.[2]);

beforeEach(() => {
  vi.clearAllMocks();
  enviarNotaPrivadaMock.mockResolvedValue(undefined);
  marcarAbiertaMock.mockResolvedValue(undefined);
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
});
