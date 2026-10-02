import { describe, it, expect, vi, beforeEach } from 'vitest';

const orden: string[] = [];
const enviarMensajeMock = vi.fn();
const enviarNotaPrivadaMock = vi.fn(async () => { orden.push('nota'); });
const marcarAbiertaMock = vi.fn(async () => { orden.push('abrir'); });
const pausarBotMock = vi.fn(async () => { orden.push('pausar'); });
const avisarAlCelularMock = vi.fn(async () => { orden.push('celular'); });

vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: pausarBotMock }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: avisarAlCelularMock }));

const { responderYEscalar, alertarEnvioIncierto, avisarEquipoYPausar, avisarMensajeFallido } =
  await import('../../src/salida/escalamiento.js');

const cfg = { id: 'c1', idiomaDefault: 'es', configExtra: {} } as never;

describe('cada nota al equipo también avisa al celular, al final (después de pausar el bot)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orden.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('responderYEscalar', async () => {
    enviarMensajeMock.mockResolvedValueOnce(55);
    await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'no_se_el_dato');
    expect(avisarAlCelularMock).toHaveBeenCalledWith(cfg, 9, expect.stringContaining('Escalado por el bot'));
    expect(orden).toEqual(['nota', 'abrir', 'pausar', 'celular']);
  });

  it('alertarEnvioIncierto', async () => {
    await alertarEnvioIncierto(cfg, 9, 'hola');
    expect(avisarAlCelularMock).toHaveBeenCalledWith(cfg, 9, expect.stringContaining('no pudo confirmar'));
    expect(orden).toEqual(['nota', 'abrir', 'pausar', 'celular']);
  });

  it('avisarEquipoYPausar (tema de alto valor)', async () => {
    await avisarEquipoYPausar(cfg, 9, 'fuera_de_alcance' as never, 'India 2027');
    expect(avisarAlCelularMock).toHaveBeenCalledWith(cfg, 9, expect.stringContaining('Tema de alto valor'));
    expect(orden).toEqual(['nota', 'abrir', 'pausar', 'celular']);
  });

  it('avisarMensajeFallido (Meta rechazó un mensaje)', async () => {
    await avisarMensajeFallido(cfg, 9, { error: 'ventana de 24 h', contenido: 'hola' });
    expect(avisarAlCelularMock).toHaveBeenCalledWith(cfg, 9, expect.stringContaining('NO llegó'));
    expect(orden).toEqual(['nota', 'abrir', 'celular']);
  });

  it('si la nota de Chatwoot falla, el celular igual se entera', async () => {
    enviarMensajeMock.mockResolvedValueOnce(55);
    enviarNotaPrivadaMock.mockRejectedValueOnce(new Error('chatwoot caído')).mockRejectedValueOnce(new Error('chatwoot caído'));
    await responderYEscalar(cfg, 9, 'es', '¿hay descuento?', 'no_se_el_dato');
    expect(avisarAlCelularMock).toHaveBeenCalledTimes(1);
  });
});
