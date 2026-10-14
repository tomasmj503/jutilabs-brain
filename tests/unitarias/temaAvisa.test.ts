import { describe, it, expect, vi, beforeEach } from 'vitest';

// #3 / PC-12: un tema de la lista AVISA al equipo y NO pausa; no se repite el aviso en cada mensaje (ventana).
const alertar = vi.fn();
const pausarBot = vi.fn();
const pendiente = vi.fn();
const redisSet = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: redisSet } }));
vi.mock('../../src/salida/alertaEquipo.js', () => ({ alertarAlEquipo: alertar, conUnReintento: async (_p: string, _c: number, f: () => Promise<void>) => { await f(); return true; } }));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: pendiente }));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot, estaPausado: async () => false, guardarIdioma: vi.fn() }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es', estadoBot: 'activo', chatwootConversationId: 7, ultimosMensajes: [] }),
  guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));
const llm = vi.fn();
vi.mock('../../src/llm/conReintento.js', () => ({ llamarLLMConReintento: llm }));
const enviarMensaje = vi.fn(async () => 99);
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje, enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');

const cfg = {
  id: 'c1', idiomas: ['es', 'en'], idiomaDefault: 'es', temasQueEscalan: ['india'], configExtra: {}, nombreBot: 'Max',
  promptBase: '', zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40,
} as never;
const turno = (texto: string) => ({
  clienteId: 'c1', chatwootConversationId: 7, textoAgrupado: texto,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 1, canal: 'whatsapp', telefono: '57300', contenido: texto, tipo: 'texto', recibidoAt: 'x' }],
}) as never;
const respuesta = (extra: object = {}) => ({
  texto: 'Claro, te cuento del viaje.', modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1,
  herramientasUsadas: [], proveedores: [], noSeElDato: false, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  redisSet.mockResolvedValue('OK');
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  llm.mockResolvedValue(respuesta());
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('tema que avisa', () => {
  it('responde, avisa al equipo y NO pausa', async () => {
    await atenderTurno(cfg, turno('quiero info del viaje a India'));
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar.mock.calls[0]?.[2]).toContain('india');
    expect(pausarBot).not.toHaveBeenCalled();
  });

  it('no abre ni desasigna la conversación: el bot sigue atendiendo', async () => {
    await atenderTurno(cfg, turno('quiero info del viaje a India'));
    expect(alertar.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('el aviso por conversación+tema se da una vez por ventana (no en cada mensaje)', async () => {
    redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    await atenderTurno(cfg, turno('info de India'));
    await atenderTurno(cfg, turno('¿y cuánto dura India?'));
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(enviarMensaje).toHaveBeenCalledTimes(2); // el bot sigue respondiendo los dos
    const [clave] = redisSet.mock.calls[0] as [string];
    expect(clave).toContain('conv1');
    expect(clave).toContain('india');
  });

  it('si Redis falla se avisa igual (mejor un aviso de más que ninguno)', async () => {
    redisSet.mockRejectedValue(new Error('Redis caído'));
    await atenderTurno(cfg, turno('info de India'));
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('si el aviso no se confirma queda pendiente SIN pausar', async () => {
    alertar.mockResolvedValue({ nota: false, celular: 'fallido', avisado: false });
    await atenderTurno(cfg, turno('info de India'));
    expect(pendiente).toHaveBeenCalledWith(cfg, 7, expect.objectContaining({ pausar: false, motivo: 'tema' }));
    expect(pausarBot).not.toHaveBeenCalled();
  });

  it('si ADEMÁS el modelo pidió una persona (pasar_a_persona), eso sí pausa, con un solo aviso', async () => {
    llm.mockResolvedValue(respuesta({ herramientasUsadas: ['pasar_a_persona'] }));
    await atenderTurno(cfg, turno('quiero reservar el viaje a India para 4'));
    expect(pausarBot).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('«informaciones» o «Indiana» no avisan ni pausan', async () => {
    await atenderTurno(cfg, turno('quiero informaciones, vivo en Indiana'));
    expect(alertar).not.toHaveBeenCalled();
    expect(pausarBot).not.toHaveBeenCalled();
  });
});
