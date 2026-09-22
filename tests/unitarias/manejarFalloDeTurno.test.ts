import { describe, it, expect, vi, beforeEach } from 'vitest';

const guardarMensajeMock = vi.fn().mockResolvedValue(undefined);
const obtenerContextoMock = vi.fn();
const enviarMensajeMock = vi.fn().mockResolvedValue(999);
const enviarNotaPrivadaMock = vi.fn().mockResolvedValue(undefined);
const marcarAbiertaMock = vi.fn().mockResolvedValue(undefined);
const pausarBotMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/conversacion/almacen.js', () => ({
  guardarMensaje: guardarMensajeMock, obtenerContexto: obtenerContextoMock,
}));
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock, marcarAbierta: marcarAbiertaMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({
  pausarBot: pausarBotMock, aplicarReactivacion: vi.fn(), estaPausado: vi.fn(), guardarIdioma: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const { manejarFalloDeTurno } = await import('../../src/ingesta/atenderTurno.js');

const turno = {
  clienteId: 'c1', chatwootConversationId: 1,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 1, chatwootContactId: 1, chatwootMessageId: 500, canal: 'whatsapp', telefono: '573000000000', contenido: 'hola', tipo: 'texto', recibidoAt: 'x' }],
  textoAgrupado: 'hola',
} as never;
const cfg = { id: 'c1', idiomaDefault: 'es', configExtra: {} } as never;

describe('manejarFalloDeTurno', () => {
  beforeEach(() => vi.clearAllMocks());

  it('si Supabase responde, guarda el mensaje del huésped y escala normalmente', async () => {
    obtenerContextoMock.mockResolvedValueOnce({ id: 'conv1', idioma: 'es' });
    await manejarFalloDeTurno(cfg, turno);
    expect(guardarMensajeMock).toHaveBeenCalledWith(cfg, expect.objectContaining({ rol: 'huesped', contenido: 'hola' }));
    expect(enviarMensajeMock).toHaveBeenCalled();
    expect(pausarBotMock).toHaveBeenCalled();
  });

  it('si Supabase sigue caído, igual avisa al huésped aunque no quede guardado', async () => {
    obtenerContextoMock.mockRejectedValueOnce(new Error('sigue caído'));
    await manejarFalloDeTurno(cfg, turno);
    expect(guardarMensajeMock).not.toHaveBeenCalled();
    expect(enviarMensajeMock).toHaveBeenCalled();
  });
});
