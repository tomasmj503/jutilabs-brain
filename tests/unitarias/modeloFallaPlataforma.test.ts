import { describe, it, expect, vi, beforeEach } from 'vitest';

// PC-21: un 402/401/400 del modelo es una falla de PLATAFORMA. No pausa a cada huésped ni le escribe «paso con el equipo»:
// una alerta operativa (una por ventana), una sola llamada al modelo, el mensaje queda sin atender para la bandeja.
const alertar = vi.fn();
const pausarBot = vi.fn();
const enviarMensaje = vi.fn(async () => 99);
const llm = vi.fn();
const redisSet = vi.fn();

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: redisSet } }));
vi.mock('../../src/salida/alertaEquipo.js', () => ({
  alertarAlEquipo: alertar, conUnReintento: async (_p: string, _c: number, f: () => Promise<void>) => { await f(); return true; },
}));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot, estaPausado: async () => false, guardarIdioma: vi.fn() }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es', estadoBot: 'activo', chatwootConversationId: 7, ultimosMensajes: [] }),
  guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));
vi.mock('../../src/llm/conReintento.js', () => ({ llamarLLMConReintento: llm }));
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje, enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');

const cfg = {
  id: 'c1', idiomas: ['es', 'en'], idiomaDefault: 'es', temasQueEscalan: [], configExtra: {}, nombreBot: 'Max',
  promptBase: '', zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40,
} as never;
const turno = (texto: string) => ({
  clienteId: 'c1', chatwootConversationId: 7, textoAgrupado: texto,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 1, canal: 'whatsapp', telefono: '57300', contenido: texto, tipo: 'texto', recibidoAt: 'x' }],
}) as never;
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  vi.clearAllMocks();
  redisSet.mockResolvedValue('OK');
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('el modelo responde con falla de plataforma', () => {
  it.each([[400], [401], [402]])('HTTP %i: no pausa, no le escribe al huésped, una alerta operativa y el turno queda sin atender', async (status) => {
    llm.mockRejectedValue(http(status));
    const r = await atenderTurno(cfg, turno('¿a qué hora es el check-in?'));
    expect(llm).toHaveBeenCalledTimes(1);
    expect(pausarBot).not.toHaveBeenCalled();
    expect(enviarMensaje).not.toHaveBeenCalled();
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(String(alertar.mock.calls[0]?.[2])).toContain(String(status));
    expect(r).toEqual({ atendido: false });
  });

  it('la alerta operativa se da una vez por ventana (no una por huésped)', async () => {
    redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    llm.mockRejectedValue(http(402));
    await atenderTurno(cfg, turno('hola, ¿hay cupo?'));
    await atenderTurno(cfg, turno('¿y precios?'));
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(pausarBot).not.toHaveBeenCalled();
  });

  it('otros errores (p. ej. un 500 que ya probó el respaldo) siguen escalando como antes', async () => {
    llm.mockRejectedValue(http(500));
    await atenderTurno(cfg, turno('hola'));
    expect(pausarBot).toHaveBeenCalledWith(cfg, 7, 'error_interno');
  });
});
