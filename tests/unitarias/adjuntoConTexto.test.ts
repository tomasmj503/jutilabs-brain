import { describe, it, expect, vi, beforeEach } from 'vitest';

// #15 / D-09: foto + texto también avisa al equipo (sin pausar, sin escribirle nada extra al huésped).
const alertar = vi.fn();
const registrarPendiente = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/salida/alertaEquipo.js', () => ({ alertarAlEquipo: alertar, conUnReintento: vi.fn() }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: registrarPendiente }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es', estadoBot: 'activo', chatwootConversationId: 7, ultimosMensajes: [] }),
  guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/estado.js', () => ({
  aplicarReactivacion: async (_c: unknown, x: unknown) => x, estaPausado: async () => false, guardarIdioma: vi.fn(), pausarBot: vi.fn(),
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));
vi.mock('../../src/llm/conReintento.js', () => ({
  llamarLLMConReintento: async () => ({
    texto: 'Gracias por avisar.', modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1, herramientasUsadas: [], proveedores: [], noSeElDato: false,
  }),
}));
const enviarMensaje = vi.fn(async () => 99);
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje, enviarNotaPrivada: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');

const cfg = {
  id: 'c1', idiomas: ['es', 'en'], idiomaDefault: 'es', temasQueEscalan: [], configExtra: {}, nombreBot: 'Max',
  promptBase: '', zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40,
} as never;
const msg = (contenido: string, tipo: string, id: number) => ({
  clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: id,
  canal: 'whatsapp', telefono: '573000000000', contenido, tipo, recibidoAt: 'x',
});
const turno = (mensajes: ReturnType<typeof msg>[]) => ({
  clienteId: 'c1', chatwootConversationId: 7, mensajes, textoAgrupado: mensajes.map((m) => m.contenido).filter(Boolean).join('\n'),
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('adjunto + texto', () => {
  it('avisa al equipo del adjunto, con el texto, y el bot igual responde al texto', async () => {
    await atenderTurno(cfg, turno([msg('ya pagué, te mando el comprobante', 'texto', 1), msg('', 'imagen', 2)]));
    expect(alertar).toHaveBeenCalledTimes(1);
    const [, conv, nota, opciones] = alertar.mock.calls[0] as [unknown, number, string, unknown];
    expect(conv).toBe(7);
    expect(nota).toContain('una imagen');
    expect(nota).toContain('ya pagué');
    expect(opciones).toBeUndefined(); // sin abrir ni pausar: solo se avisa
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
  });

  it('solo texto: no hay aviso de adjunto', async () => {
    await atenderTurno(cfg, turno([msg('hola', 'texto', 1)]));
    expect(alertar).not.toHaveBeenCalled();
  });

  it('si el aviso no se confirma queda pendiente (no se pierde)', async () => {
    alertar.mockResolvedValue({ nota: false, celular: 'fallido', avisado: false });
    await atenderTurno(cfg, turno([msg('ya pagué', 'texto', 1), msg('', 'imagen', 2)]));
    expect(registrarPendiente).toHaveBeenCalledWith(cfg, 7, expect.objectContaining({ motivo: 'adjunto_con_texto', pausar: false }));
  });

  it('un fallo al avisar no frena el turno', async () => {
    alertar.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await atenderTurno(cfg, turno([msg('ya pagué', 'texto', 1), msg('', 'imagen', 2)]));
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
  });
});
