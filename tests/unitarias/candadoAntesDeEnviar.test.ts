import { describe, it, expect, vi, beforeEach } from 'vitest';

// ADR-11 / PC-14: si al terminar el modelo el candado ya no es nuestro, el turno NO envía y escala.
const alertar = vi.fn();
const enviarMensaje = vi.fn(async () => 99);
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/salida/alertaEquipo.js', () => ({
  alertarAlEquipo: alertar, conUnReintento: async (_p: string, _c: number, f: () => Promise<void>) => { await f(); return true; },
}));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot: vi.fn(), estaPausado: async () => false, guardarIdioma: vi.fn() }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es', estadoBot: 'activo', chatwootConversationId: 7, ultimosMensajes: [] }),
  guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));
vi.mock('../../src/llm/conReintento.js', () => ({
  llamarLLMConReintento: async () => ({
    texto: 'Respuesta', modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1, herramientasUsadas: [], proveedores: [], noSeElDato: false,
  }),
}));
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje, enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');
const cfg = {
  id: 'c1', idiomas: ['es'], idiomaDefault: 'es', temasQueEscalan: [], configExtra: {}, nombreBot: 'Max',
  promptBase: '', zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40,
} as never;
const turno = {
  clienteId: 'c1', chatwootConversationId: 7, textoAgrupado: '¿hora de check-in?',
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 1, canal: 'whatsapp', telefono: '57300', contenido: '¿hora de check-in?', tipo: 'texto', recibidoAt: 'x' }],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('candado antes de enviar', () => {
  it('candado propio: envía normalmente', async () => {
    const r = await atenderTurno(cfg, turno, { sigueSiendoMio: async () => true });
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ atendido: true });
  });
  it('candado perdido: NO envía, avisa al equipo y el turno queda sin atender', async () => {
    const r = await atenderTurno(cfg, turno, { sigueSiendoMio: async () => false });
    expect(enviarMensaje).not.toHaveBeenCalled();
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ atendido: false });
  });
  it('sin candado (llamadas directas, p. ej. pruebas) no cambia nada', async () => {
    await atenderTurno(cfg, turno);
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
  });
});
