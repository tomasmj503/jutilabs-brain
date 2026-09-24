import { describe, it, expect, vi, beforeEach } from 'vitest';

const enviarMensajeMock = vi.fn();
const enviarNotaPrivadaMock = vi.fn().mockResolvedValue(undefined);
const marcarAbiertaMock = vi.fn().mockResolvedValue(undefined);
const pausarBotMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: pausarBotMock }));

const { responderYEscalar, alertarEnvioIncierto } = await import('../../src/salida/escalamiento.js');
const { EnvioIncierto } = await import('../../src/salida/errores.js');

const cfg = { id: 'c1', idiomaDefault: 'es', configExtra: {} } as never;
const notaEnviada = () => String(enviarNotaPrivadaMock.mock.calls[0]?.[2]);

describe('responderYEscalar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enviarNotaPrivadaMock.mockResolvedValue(undefined);
  });

  it('camino normal: avisa al huésped, deja nota, abre y pausa', async () => {
    enviarMensajeMock.mockResolvedValueOnce(55);
    const r = await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'no_se_el_dato');
    expect(r).toMatchObject({ mensajeId: 55, envio: 'enviado' });
    expect(notaEnviada()).not.toContain('⚠️');
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'no_se_el_dato');
  });

  it('si el aviso al huésped NO sale, el equipo igual se entera: nota, abrir y pausar', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new Error('sin red'));
    const r = await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'error_interno');
    expect(r).toMatchObject({ mensajeId: null, envio: 'fallo' });
    expect(notaEnviada()).toContain('NO salió');
    expect(notaEnviada()).toContain('¿hay descuento?');
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'error_interno');
  });

  it('si no se pudo confirmar el envío, la nota le dice al equipo que revise antes de escribir', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new EnvioIncierto('no-se', new Error('x')));
    const r = await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(r).toMatchObject({ mensajeId: null, envio: 'incierto' });
    expect(notaEnviada()).toContain('No se pudo confirmar');
    expect(pausarBotMock).toHaveBeenCalled();
  });

  it('nunca reenvía el aviso por su cuenta: un solo intento de envío', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new Error('sin red'));
    await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(enviarMensajeMock).toHaveBeenCalledTimes(1);
  });
});

describe('alertarEnvioIncierto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enviarNotaPrivadaMock.mockResolvedValue(undefined);
  });

  it('avisa al equipo y pausa, SIN mandar ningún mensaje al huésped', async () => {
    await alertarEnvioIncierto(cfg, 9, 'quiero reservar');
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(notaEnviada()).toContain('no pudo confirmar');
    expect(notaEnviada()).toContain('quiero reservar');
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'error_interno');
  });
});
