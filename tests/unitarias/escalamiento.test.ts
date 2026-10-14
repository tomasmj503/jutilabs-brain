import { describe, it, expect, vi, beforeEach } from 'vitest';

const enviarMensajeMock = vi.fn();
const enviarNotaPrivadaMock = vi.fn();
const marcarAbiertaMock = vi.fn();
const pausarBotMock = vi.fn();
const avisarAlCelularMock = vi.fn();
const registrarAvisoPendienteMock = vi.fn();

vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: pausarBotMock }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: avisarAlCelularMock }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: registrarAvisoPendienteMock }));

const { responderYEscalar, alertarEnvioIncierto, avisarEquipoYPausar } = await import('../../src/salida/escalamiento.js');
const { EnvioIncierto } = await import('../../src/salida/errores.js');

const cfg = { id: 'c1', idiomaDefault: 'es', configExtra: {} } as never;
const notas = () => enviarNotaPrivadaMock.mock.calls.map((c) => String(c[2]));
const primeraNota = () => notas()[0] ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  enviarNotaPrivadaMock.mockResolvedValue(undefined);
  marcarAbiertaMock.mockResolvedValue(undefined);
  pausarBotMock.mockResolvedValue(undefined);
  avisarAlCelularMock.mockResolvedValue('enviado');
  registrarAvisoPendienteMock.mockResolvedValue(undefined);
});

describe('responderYEscalar', () => {
  it('camino normal: nota, abre, avisa al celular, pausa y recién entonces le escribe al huésped', async () => {
    enviarMensajeMock.mockResolvedValueOnce(55);
    const r = await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'no_se_el_dato');
    expect(r).toMatchObject({ mensajeId: 55, envio: 'enviado', avisado: true });
    expect(primeraNota()).not.toContain('⚠️');
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'no_se_el_dato');
    expect(registrarAvisoPendienteMock).not.toHaveBeenCalled();
  });

  it('si el aviso al huésped NO sale, el equipo ya estaba avisado: se le agrega que debe escribirle', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new Error('sin red'));
    const r = await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'error_interno');
    expect(r).toMatchObject({ mensajeId: null, envio: 'fallo', avisado: true });
    expect(primeraNota()).toContain('¿hay descuento?');
    expect(notas().some((n) => n.includes('NO salió'))).toBe(true);
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'error_interno');
  });

  it('si no se pudo confirmar el envío, la nota le dice al equipo que revise antes de escribir', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new EnvioIncierto('no-se', new Error('x')));
    const r = await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(r).toMatchObject({ mensajeId: null, envio: 'incierto' });
    expect(notas().some((n) => n.includes('No se pudo confirmar'))).toBe(true);
    expect(pausarBotMock).toHaveBeenCalled();
  });

  it('nunca reenvía el aviso por su cuenta: un solo intento de envío', async () => {
    enviarMensajeMock.mockRejectedValueOnce(new Error('sin red'));
    await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(enviarMensajeMock).toHaveBeenCalledTimes(1);
  });

  // ---- PC-15 (INT-ALERTAS): «nunca decir "ya avisé" si no salió» ----
  it('n8n falla: NO le escribe al huésped, NO pausa, y deja el aviso pendiente (con el texto y la pausa por completar)', async () => {
    avisarAlCelularMock.mockResolvedValue('fallido');
    const r = await responderYEscalar(cfg, 9, 'es', 'quiero hablar con alguien', 'pidio_humano');
    expect(r).toMatchObject({ mensajeId: null, envio: 'no_enviado', avisado: false });
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(pausarBotMock).not.toHaveBeenCalled();
    expect(registrarAvisoPendienteMock).toHaveBeenCalledWith(cfg, 9, expect.objectContaining({
      motivo: 'pidio_humano', pausar: true, notaCreada: true, textoHuesped: expect.stringContaining('equipo'),
    }));
  });

  it('Chatwoot (nota) y n8n fallan a la vez: tampoco hay texto al huésped y queda pendiente con la nota por crear', async () => {
    enviarNotaPrivadaMock.mockRejectedValue(new Error('Chatwoot 500'));
    avisarAlCelularMock.mockResolvedValue('fallido');
    const r = await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(r.avisado).toBe(false);
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(registrarAvisoPendienteMock).toHaveBeenCalledWith(cfg, 9, expect.objectContaining({ notaCreada: false }));
  });

  it('cliente sin grupo de avisos: la nota privada ES el aviso (único canal) y se continúa', async () => {
    avisarAlCelularMock.mockResolvedValue('sin_canal');
    enviarMensajeMock.mockResolvedValueOnce(56);
    const r = await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(r.avisado).toBe(true);
    expect(pausarBotMock).toHaveBeenCalled();
  });

  it('cliente sin grupo de avisos y la nota también falla: no hay ningún aviso → pendiente', async () => {
    avisarAlCelularMock.mockResolvedValue('sin_canal');
    enviarNotaPrivadaMock.mockRejectedValue(new Error('Chatwoot 500'));
    const r = await responderYEscalar(cfg, 9, 'es', 'hola', 'no_se_el_dato');
    expect(r.avisado).toBe(false);
    expect(enviarMensajeMock).not.toHaveBeenCalled();
  });
});

describe('alertarEnvioIncierto', () => {
  it('avisa al equipo y pausa, SIN mandar ningún mensaje al huésped', async () => {
    expect(await alertarEnvioIncierto(cfg, 9, 'quiero reservar')).toBe(true);
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(primeraNota()).toContain('no pudo confirmar');
    expect(primeraNota()).toContain('quiero reservar');
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'error_interno');
  });

  it('si el aviso no se confirma: no pausa y queda pendiente', async () => {
    avisarAlCelularMock.mockResolvedValue('fallido');
    expect(await alertarEnvioIncierto(cfg, 9, 'quiero reservar')).toBe(false);
    expect(pausarBotMock).not.toHaveBeenCalled();
    expect(registrarAvisoPendienteMock).toHaveBeenCalledWith(cfg, 9, expect.objectContaining({ pausar: true, textoHuesped: null }));
  });
});

describe('avisarEquipoYPausar', () => {
  it('con el aviso confirmado pausa', async () => {
    expect(await avisarEquipoYPausar(cfg, 9, 'fuera_de_alcance' as never, 'India 2027')).toBe(true);
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 9, 'fuera_de_alcance');
  });
  it('sin aviso confirmado no pausa y queda pendiente', async () => {
    avisarAlCelularMock.mockResolvedValue('fallido');
    expect(await avisarEquipoYPausar(cfg, 9, 'fuera_de_alcance' as never, 'India 2027')).toBe(false);
    expect(pausarBotMock).not.toHaveBeenCalled();
    expect(registrarAvisoPendienteMock).toHaveBeenCalledTimes(1);
  });
});
