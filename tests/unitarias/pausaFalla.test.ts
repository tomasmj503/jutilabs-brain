import { describe, it, expect, vi, beforeEach } from 'vitest';

// PC-10 (UNI-PUERTA): si la pausa falla, o no se puede saber quién escribió, NO se calla: alerta al equipo.
const pausarBot = vi.fn();
const idUsuarioBot = vi.fn();
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
vi.mock('../../src/salida/chatwoot.js', () => ({ idUsuarioBot, enviarMensaje: vi.fn(), enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));
vi.mock('../../src/salida/alertaEquipo.js', async () => ({
  alertarAlEquipo: alertar,
  // conUnReintento real: repite una vez y dice si salió
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
const cfg = { id: 'c1', idiomaDefault: 'es' } as never;
const persona = {
  evento: 'message_created', direccion: 'saliente', privado: false, messageId: 20, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'user', remitenteId: 42, contenido: 'Hola, soy Andrea',
  estado: null, errorExterno: null, adjuntos: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  idUsuarioBot.mockResolvedValue(1);
  pausarBot.mockResolvedValue(undefined);
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('procesarSaliente', () => {
  it('camino normal: una persona escribió → pausa, sin alertas', async () => {
    await procesarSaliente(cfg, persona);
    expect(pausarBot).toHaveBeenCalledWith(cfg, 7, 'agente_respondio');
    expect(alertar).not.toHaveBeenCalled();
  });

  it('idUsuarioBot lanza: no se calla, alerta («el bot NO se pausó») y no lanza', async () => {
    idUsuarioBot.mockRejectedValue(new Error('Chatwoot caído'));
    await expect(procesarSaliente(cfg, persona)).resolves.toBeUndefined();
    expect(pausarBot).not.toHaveBeenCalled();
    expect(alertar).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO se pausó'));
  });

  it('la pausa falla las dos veces: alerta «NO SE PUDO PAUSAR» (y no lanza)', async () => {
    pausarBot.mockRejectedValue(new Error('Supabase caído'));
    await expect(procesarSaliente(cfg, persona)).resolves.toBeUndefined();
    expect(pausarBot).toHaveBeenCalledTimes(2);
    expect(alertar).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO SE PUDO PAUSAR'));
    expect(pendiente).not.toHaveBeenCalled(); // el aviso sí salió
  });

  it('la pausa falla y el aviso tampoco sale: queda pendiente para que el barrido reintente la pausa', async () => {
    pausarBot.mockRejectedValue(new Error('Supabase caído'));
    alertar.mockResolvedValue({ nota: false, celular: 'fallido', avisado: false });
    await procesarSaliente(cfg, persona);
    expect(pendiente).toHaveBeenCalledWith(cfg, 7, expect.objectContaining({ pausar: true, motivo: 'agente_respondio' }));
  });

  it('la pausa falla una vez y el reintento funciona: no hay alerta', async () => {
    pausarBot.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(undefined);
    await procesarSaliente(cfg, persona);
    expect(alertar).not.toHaveBeenCalled();
  });

  it('un mensaje del propio bot (o una nota privada) no pausa ni alerta', async () => {
    await procesarSaliente(cfg, { ...(persona as object), remitenteId: 1 } as never);
    await procesarSaliente(cfg, { ...(persona as object), privado: true } as never);
    expect(pausarBot).not.toHaveBeenCalled();
    expect(alertar).not.toHaveBeenCalled();
  });
});
