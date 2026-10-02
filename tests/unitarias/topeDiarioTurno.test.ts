import { describe, it, expect, vi, beforeEach } from 'vitest';

const guardarMensajeMock = vi.fn().mockResolvedValue(undefined);
const obtenerContextoMock = vi.fn();
const enviarMensajeMock = vi.fn().mockResolvedValue(999);
const responderYEscalarMock = vi.fn().mockResolvedValue({ texto: 'T', mensajeId: 10, envio: 'enviado' });
const llamarLLMMock = vi.fn();
const ruteoMock = vi.fn();
const llegoAlTopeMock = vi.fn();

vi.mock('../../src/conversacion/almacen.js', () => ({ guardarMensaje: guardarMensajeMock, obtenerContexto: obtenerContextoMock }));
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje: enviarMensajeMock, enviarNotaPrivada: vi.fn() }));
vi.mock('../../src/salida/escalamiento.js', () => ({
  alertarEnvioIncierto: vi.fn(), responderYEscalar: responderYEscalarMock, avisarEquipoYPausar: vi.fn(),
}));
vi.mock('../../src/conversacion/estado.js', () => ({
  aplicarReactivacion: async (_c: unknown, conv: unknown) => conv,
  estaPausado: async () => false, guardarIdioma: vi.fn(), pausarBot: vi.fn(),
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: llegoAlTopeMock }));
vi.mock('../../src/llm/conReintento.js', () => ({ llamarLLMConReintento: llamarLLMMock }));
vi.mock('../../src/llm/prompt.js', () => ({ construirSystemPrompt: () => 'sistema' }));
vi.mock('../../src/router/index.js', () => ({ rutear: ruteoMock }));
vi.mock('../../src/router/texto.js', async (orig) => ({
  ...(await orig<object>()), detectarIdioma: () => 'es', esSoloSaludo: () => false,
}));
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');

const cfg = { id: 'c1', idiomaDefault: 'es', idiomas: ['es', 'en'], configExtra: {}, limiteMensajesDiaConversacion: 40 } as never;
const turno = {
  clienteId: 'c1', chatwootConversationId: 1, textoAgrupado: 'hola de nuevo',
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 1, chatwootContactId: 1, chatwootMessageId: 500, canal: 'whatsapp', telefono: '573000000000', contenido: 'hola de nuevo', tipo: 'texto', recibidoAt: 'x' }],
} as never;
const conv = {
  id: 'conv1', clienteId: 'c1', chatwootConversationId: 1, canal: 'whatsapp', idioma: 'es', pais: null,
  estadoBot: 'activo', formularioActivo: null, mensajesSalientesHoy: 0, ultimosMensajes: [],
};
const respuesta = { texto: 'Claro', noSeElDato: false, herramientasUsadas: ['consultar_faq'], modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1 };

describe('atenderTurno: tope diario de mensajes por conversación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    obtenerContextoMock.mockResolvedValue(conv);
    ruteoMock.mockResolvedValue({ tipo: 'responder' });
    llamarLLMMock.mockResolvedValue(respuesta);
  });
  it('llegó al tope: no llama al modelo y escala con limite_mensajes', async () => {
    llegoAlTopeMock.mockResolvedValue(true);
    await atenderTurno(cfg, turno);
    expect(llegoAlTopeMock).toHaveBeenCalledWith(cfg, 'conv1');
    expect(llamarLLMMock).not.toHaveBeenCalled();
    expect(enviarMensajeMock).not.toHaveBeenCalled();
    expect(responderYEscalarMock).toHaveBeenCalledWith(cfg, 1, 'es', 'hola de nuevo', 'limite_mensajes');
  });
  it('debajo del tope: responde normal', async () => {
    llegoAlTopeMock.mockResolvedValue(false);
    await atenderTurno(cfg, turno);
    expect(llamarLLMMock).toHaveBeenCalledTimes(1);
    expect(enviarMensajeMock).toHaveBeenCalledWith(cfg, 1, 'Claro');
    expect(responderYEscalarMock).not.toHaveBeenCalled();
  });
  it('pedir una persona va antes que el tope', async () => {
    llegoAlTopeMock.mockResolvedValue(true);
    ruteoMock.mockResolvedValue({ tipo: 'escalar', motivo: 'pidio_humano', mensajeAlHuesped: null });
    await atenderTurno(cfg, turno);
    expect(responderYEscalarMock).toHaveBeenCalledWith(cfg, 1, 'es', 'hola de nuevo', 'pidio_humano');
    expect(llegoAlTopeMock).not.toHaveBeenCalled();
  });
});
