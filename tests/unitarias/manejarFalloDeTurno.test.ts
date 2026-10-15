import { describe, it, expect, vi, beforeEach } from 'vitest';

const guardarMensajeMock = vi.fn().mockResolvedValue(undefined);
const obtenerContextoMock = vi.fn();
const enviarMensajeMock = vi.fn().mockResolvedValue(999);
const enviarNotaPrivadaMock = vi.fn().mockResolvedValue(undefined);
const marcarAbiertaMock = vi.fn().mockResolvedValue(undefined);
const pausarBotMock = vi.fn().mockResolvedValue(undefined);
const avisarAlCelularMock = vi.fn().mockResolvedValue('enviado');

vi.mock('../../src/conversacion/almacen.js', () => ({
  guardarMensaje: guardarMensajeMock, obtenerContexto: obtenerContextoMock,
}));
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: avisarAlCelularMock }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/conversacion/estado.js', () => ({
  pausarBot: pausarBotMock, aplicarReactivacion: vi.fn(), estaPausado: vi.fn(), guardarIdioma: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const { manejarFalloDeTurno } = await import('../../src/ingesta/atenderTurno.js');
const { EnvioIncierto } = await import('../../src/salida/errores.js');

const turno = {
  clienteId: 'c1', chatwootConversationId: 1,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 1, chatwootContactId: 1, chatwootMessageId: 500, canal: 'whatsapp', telefono: '573000000000', contenido: 'hola', tipo: 'texto', recibidoAt: 'x' }],
  textoAgrupado: 'hola',
} as never;
const cfg = { id: 'c1', idiomaDefault: 'es', configExtra: {} } as never;

describe('manejarFalloDeTurno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    avisarAlCelularMock.mockResolvedValue('enviado');
  });

  it('si Supabase responde, guarda el mensaje del huésped y escala normalmente', async () => {
    obtenerContextoMock.mockResolvedValueOnce({ id: 'conv1', idioma: 'es' });
    await manejarFalloDeTurno(cfg, turno);
    expect(guardarMensajeMock).toHaveBeenCalledWith(cfg, expect.objectContaining({ rol: 'huesped', contenido: 'hola' }));
    expect(enviarMensajeMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalled();
  });

  // PC-20 / #13: si no se puede leer el estado de la conversación NO se sabe si una persona la tiene tomada:
  // no se le escribe al huésped ni se toca la asignación; solo se avisa al equipo. (Antes esta prueba fijaba
  // lo contrario: «igual avisa al huésped».)
  it('si Supabase sigue caído (estado ilegible): NO le escribe al huésped; deja nota y avisa al equipo', async () => {
    obtenerContextoMock.mockRejectedValueOnce(new Error('sigue caído'));
    await manejarFalloDeTurno(cfg, turno);
    expect(guardarMensajeMock).not.toHaveBeenCalled();
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(pausarBotMock).not.toHaveBeenCalled();
    expect(enviarNotaPrivadaMock).toHaveBeenCalledWith(cfg, 1, expect.stringContaining('hola'));
    expect(avisarAlCelularMock).toHaveBeenCalledWith(cfg, 1, expect.stringContaining('hola'));
  });

  it('si la conversación está pausada (una persona la tiene): no le escribe al huésped ni escala otra vez', async () => {
    obtenerContextoMock.mockResolvedValueOnce({ id: 'conv1', idioma: 'es', estadoBot: 'pausado' });
    const r = await manejarFalloDeTurno(cfg, turno);
    expect(r).toEqual({ atendido: true });
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(pausarBotMock).not.toHaveBeenCalled();
  });

  it('si la falla fue un envío que no se pudo confirmar: NO manda otro mensaje al huésped, solo alerta al equipo', async () => {
    await manejarFalloDeTurno(cfg, turno, new EnvioIncierto('no-se', new Error('x')));
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(obtenerContextoMock).not.toHaveBeenCalled();
    expect(enviarNotaPrivadaMock).toHaveBeenCalledWith(cfg, 1, expect.stringContaining('no pudo confirmar'));
    expect(marcarAbiertaMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalledWith(cfg, 1, 'error_interno');
  });

  it('si el aviso al huésped no sale, igual deja nota y pausa, y no guarda un mensaje del bot que no existe', async () => {
    obtenerContextoMock.mockResolvedValueOnce({ id: 'conv1', idioma: 'es', chatwootConversationId: 1 });
    enviarMensajeMock.mockRejectedValueOnce(new Error('sin red'));
    await manejarFalloDeTurno(cfg, turno);
    expect(enviarNotaPrivadaMock).toHaveBeenCalledWith(cfg, 1, expect.stringContaining('NO salió'));
    expect(pausarBotMock).toHaveBeenCalled();
    const guardados = guardarMensajeMock.mock.calls.map((c) => (c[1] as { rol: string }).rol);
    expect(guardados).toEqual(['huesped']);
  });
});
