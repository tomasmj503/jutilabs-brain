import { describe, it, expect, vi, beforeEach } from 'vitest';

// #18 / PC-23 (CON-APAGADO): con bot_activo=false el bot NO responde, pero el mensaje queda guardado (ya atendido,
// para que al volver a prenderlo el barrido no conteste historia vieja) y la conversación queda abierta para el equipo.
const asegurar = vi.fn();
const guardar = vi.fn();
const marcar = vi.fn();
const abrir = vi.fn();
const enviar = vi.fn();
const celular = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: {} }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  asegurarConversacion: asegurar, guardarMensaje: guardar, marcarAtendidos: marcar,
}));
vi.mock('../../src/salida/chatwoot.js', () => ({
  marcarAbierta: abrir, enviarMensaje: enviar, enviarNotaPrivada: vi.fn(),
}));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: celular }));
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ atenderYMarcar: vi.fn() }));

const { recibirConBotApagado } = await import('../../src/ingesta/bandeja.js');

const cfg = { id: 'c1', activo: true, botActivo: false, chatwootAccountId: 1 } as never;
const aviso = (extra: Record<string, unknown> = {}) => ({
  evento: 'message_created', direccion: 'entrante', privado: false, messageId: 501, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'contact', remitenteId: 5, contenido: 'hola, ¿hay cupo?',
  estado: null, errorExterno: null, adjuntos: [], ...extra,
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  asegurar.mockResolvedValue({ id: 'conv-1' });
  guardar.mockResolvedValue(undefined);
  marcar.mockResolvedValue(undefined);
  abrir.mockResolvedValue(undefined);
  celular.mockResolvedValue('enviado');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('recibirConBotApagado', () => {
  it('guarda el mensaje (ya atendido), abre la conversación y NO le escribe al huésped', async () => {
    await recibirConBotApagado(cfg, aviso());
    expect(guardar).toHaveBeenCalledWith(cfg, expect.objectContaining({ rol: 'huesped', contenido: 'hola, ¿hay cupo?', chatwootMessageId: 501, atendidoAt: expect.any(String) }));
    expect(marcar).toHaveBeenCalledWith(cfg, [501]);
    expect(abrir).toHaveBeenCalledWith(cfg, 7);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('también guarda un adjunto sin texto', async () => {
    await recibirConBotApagado(cfg, aviso({ contenido: '', adjuntos: ['image'] }));
    expect(guardar).toHaveBeenCalledWith(cfg, expect.objectContaining({ contenido: '[imagen]', tipo: 'imagen' }));
    expect(abrir).toHaveBeenCalled();
  });

  it('si no se puede abrir la conversación, avisa al celular (el equipo no la vería)', async () => {
    abrir.mockRejectedValue(new Error('Chatwoot 500'));
    await recibirConBotApagado(cfg, aviso());
    expect(celular).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('bot apagado'));
  });

  it('si guardar falla igual abre la conversación (el equipo la ve) y no lanza', async () => {
    guardar.mockRejectedValue(new Error('Supabase caído'));
    await expect(recibirConBotApagado(cfg, aviso())).resolves.toBeUndefined();
    expect(abrir).toHaveBeenCalledWith(cfg, 7);
  });

  it('un aviso que no es mensaje del huésped (privado o saliente) no hace nada', async () => {
    await recibirConBotApagado(cfg, aviso({ privado: true }));
    await recibirConBotApagado(cfg, aviso({ direccion: 'saliente' }));
    expect(guardar).not.toHaveBeenCalled();
    expect(abrir).not.toHaveBeenCalled();
  });
});
