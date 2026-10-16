import { describe, it, expect, vi, beforeEach } from 'vitest';

// Modo Agent Bot (cfg.chatwootBotTokenRef): #max reactiva en Supabase Y devuelve la conversación a "pending"; el bot se
// reconoce por sender.type "agent_bot", sin consultar /api/v1/profile. El modo anterior lo cubre liberacion.test.ts.
const reactivarBot = vi.fn();
const limpiarAviso = vi.fn();
const idUsuarioBot = vi.fn();
const cambiarEstado = vi.fn();
const nota = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/conversacion/estado.js', () => ({ reactivarBot, pausarBot: vi.fn() }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ limpiarAvisoPendiente: limpiarAviso, registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/salida/chatwoot.js', () => ({ idUsuarioBot, cambiarEstado, enviarNotaPrivada: nota, enviarMensaje: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));
vi.mock('../../src/ingesta/dedup.js', () => ({ yaProcesado: vi.fn(async () => false) }));
vi.mock('../../src/ingesta/atenderTurno.js', () => ({ avisarFallo: () => () => undefined }));

const { procesarLiberacion } = await import('../../src/ingesta/liberacion.js');
const { yaProcesado } = await import('../../src/ingesta/dedup.js');

const cfg = { id: 'c1', idiomaDefault: 'es', chatwootBotTokenRef: 'BOT_TOKEN' } as never;
const aviso = (extra: Record<string, unknown> = {}) => ({
  evento: 'message_created', direccion: 'saliente', privado: true, messageId: 30, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'user', remitenteId: 42, contenido: '#max',
  estado: null, errorExterno: null, adjuntos: [], ...extra,
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  reactivarBot.mockResolvedValue(undefined);
  limpiarAviso.mockResolvedValue(undefined);
  cambiarEstado.mockResolvedValue(undefined);
  nota.mockResolvedValue(undefined);
  vi.mocked(yaProcesado).mockResolvedValue(false);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('procesarLiberacion (modo Agent Bot)', () => {
  it('una persona escribe «#max» en una nota privada → se reactiva y la conversación vuelve a "pending"', async () => {
    await procesarLiberacion(cfg, aviso());
    expect(reactivarBot).toHaveBeenCalledWith(cfg, 7);
    expect(cambiarEstado).toHaveBeenCalledWith(cfg, 7, 'pending');
    expect(limpiarAviso).toHaveBeenCalledWith(cfg, 7);
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('Max'));
    expect(idUsuarioBot).not.toHaveBeenCalled(); // el token del Agent Bot no puede pedir el perfil
  });

  it('reactiva en Supabase y DESPUÉS pone "pending"', async () => {
    const orden: string[] = [];
    reactivarBot.mockImplementation(async () => { orden.push('reactivar'); });
    cambiarEstado.mockImplementation(async (_c: unknown, _i: number, estado: string) => { orden.push(`estado:${estado}`); });
    await procesarLiberacion(cfg, aviso());
    expect(orden).toEqual(['reactivar', 'estado:pending']);
  });

  it('la nota del PROPIO bot (sender.type "agent_bot") no libera', async () => {
    await procesarLiberacion(cfg, aviso({ remitenteTipo: 'agent_bot', remitenteId: 3 }));
    expect(reactivarBot).not.toHaveBeenCalled();
    expect(cambiarEstado).not.toHaveBeenCalled();
  });

  it('un usuario cuyo id coincide con otro cualquiera libera: el bot se reconoce por el tipo, no por el id', async () => {
    await procesarLiberacion(cfg, aviso({ remitenteId: 1 }));
    expect(reactivarBot).toHaveBeenCalledTimes(1);
  });

  it('un remitente que no es usuario de Chatwoot no libera', async () => {
    await procesarLiberacion(cfg, aviso({ remitenteTipo: 'contact' }));
    expect(reactivarBot).not.toHaveBeenCalled();
  });

  it('el mismo aviso repetido por Chatwoot libera una sola vez', async () => {
    vi.mocked(yaProcesado).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await procesarLiberacion(cfg, aviso());
    await procesarLiberacion(cfg, aviso());
    expect(reactivarBot).toHaveBeenCalledTimes(1);
    expect(cambiarEstado).toHaveBeenCalledTimes(1);
  });

  it('si Chatwoot no deja ponerla en "pending", NO dice que Max volvió: avisa que falló y no lanza', async () => {
    cambiarEstado.mockRejectedValue(new Error('Chatwoot 500'));
    await expect(procesarLiberacion(cfg, aviso())).resolves.toBeUndefined();
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO se pudo'));
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('Pendiente'));
    expect(nota).not.toHaveBeenCalledWith(cfg, 7, expect.stringContaining('volvió a atender'));
  });

  it('si reactivar falla, lo deja claro en una nota, no toca el estado y no lanza', async () => {
    reactivarBot.mockRejectedValue(new Error('Supabase caído'));
    await expect(procesarLiberacion(cfg, aviso())).resolves.toBeUndefined();
    expect(nota).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('NO se pudo'));
    expect(cambiarEstado).not.toHaveBeenCalled();
  });
});
