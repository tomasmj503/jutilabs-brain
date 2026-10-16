import { describe, it, expect, vi, beforeEach } from 'vitest';

// Modo Agent Bot (cfg.chatwootBotTokenRef): lo del bot es sender.type "agent_bot"; si escribe una persona, se pausa y la
// conversación pasa a "open". El modo anterior lo cubre pausaFalla.test.ts.
const pausarBot = vi.fn();
const idUsuarioBot = vi.fn();
const cambiarEstado = vi.fn();
const alertar = vi.fn();
const pendiente = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es' }), guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: pendiente }));
vi.mock('../../src/salida/chatwoot.js', () => ({ idUsuarioBot, cambiarEstado, enviarMensaje: vi.fn(), enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));
vi.mock('../../src/salida/alertaEquipo.js', async () => ({
  alertarAlEquipo: alertar,
  conUnReintento: async (_p: string, _c: number, f: () => Promise<void>) => {
    for (let i = 0; i < 2; i++) {
      try { await f(); return true; } catch { /* siguiente intento */ }
    }
    return false;
  },
}));
vi.mock('../../src/ingesta/dedup.js', () => ({ yaProcesado: async () => false }));
vi.mock('../../src/ingesta/atenderTurno.js', () => ({ avisarFallo: () => () => undefined }));

const { procesarSaliente } = await import('../../src/ingesta/procesarSaliente.js');
const cfg = { id: 'c1', idiomaDefault: 'es', chatwootBotTokenRef: 'BOT_TOKEN' } as never;
const persona = {
  evento: 'message_created', direccion: 'saliente', privado: false, messageId: 20, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'user', remitenteId: 42, contenido: 'Hola, soy Andrea',
  estado: null, errorExterno: null, adjuntos: [],
} as never;
const con = (extra: Record<string, unknown>) => ({ ...(persona as object), ...extra }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  pausarBot.mockResolvedValue(undefined);
  cambiarEstado.mockResolvedValue(undefined);
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('procesarSaliente (modo Agent Bot)', () => {
  it('una persona responde: se pausa Y la conversación pasa a "open", sin consultar el perfil del bot', async () => {
    await procesarSaliente(cfg, persona);
    expect(pausarBot).toHaveBeenCalledWith(cfg, 7, 'agente_respondio');
    expect(cambiarEstado).toHaveBeenCalledWith(cfg, 7, 'open');
    expect(idUsuarioBot).not.toHaveBeenCalled();
    expect(alertar).not.toHaveBeenCalled();
  });

  it('un mensaje del propio bot (sender.type "agent_bot") se ignora: no pausa, no abre y no alerta', async () => {
    await procesarSaliente(cfg, con({ remitenteTipo: 'agent_bot', remitenteId: 3 }));
    expect(pausarBot).not.toHaveBeenCalled();
    expect(cambiarEstado).not.toHaveBeenCalled();
    expect(alertar).not.toHaveBeenCalled();
    expect(idUsuarioBot).not.toHaveBeenCalled();
  });

  it('una nota privada nunca pausa ni abre', async () => {
    await procesarSaliente(cfg, con({ privado: true }));
    expect(pausarBot).not.toHaveBeenCalled();
    expect(cambiarEstado).not.toHaveBeenCalled();
  });

  it('un usuario con id parecido al del bot SÍ cuenta como persona: el bot se reconoce por el tipo, no por el id', async () => {
    await procesarSaliente(cfg, con({ remitenteId: 1 }));
    expect(pausarBot).toHaveBeenCalledTimes(1);
  });

  it('pasar a "open" falla: el bot igual queda pausado, sin alerta y sin lanzar', async () => {
    cambiarEstado.mockRejectedValue(new Error('Chatwoot 500'));
    await expect(procesarSaliente(cfg, persona)).resolves.toBeUndefined();
    expect(pausarBot).toHaveBeenCalledTimes(1);
    expect(alertar).not.toHaveBeenCalled();
  });

  it('la pausa falla: igual se abre (segunda barrera: el bot solo atiende en "pending") y se alerta', async () => {
    pausarBot.mockRejectedValue(new Error('Supabase caído'));
    await procesarSaliente(cfg, persona);
    expect(cambiarEstado).toHaveBeenCalledWith(cfg, 7, 'open');
    expect(alertar).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO SE PUDO PAUSAR'));
  });

  it('la pausa falla y el aviso tampoco sale: queda pendiente para que el barrido reintente la pausa', async () => {
    pausarBot.mockRejectedValue(new Error('Supabase caído'));
    alertar.mockResolvedValue({ nota: false, celular: 'fallido', avisado: false });
    await procesarSaliente(cfg, persona);
    expect(pendiente).toHaveBeenCalledWith(cfg, 7, expect.objectContaining({ pausar: true, motivo: 'agente_respondio' }));
  });
});
