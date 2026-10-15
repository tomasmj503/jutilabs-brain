import { describe, it, expect, vi, beforeEach } from 'vitest';

// #19: candado agotado → no es solo un log: nota + aviso al equipo.
const alertar = vi.fn();
vi.mock('../../src/config/env.js', () => ({ env: { BUFFER_MS: 0 }, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/redis.js', () => ({ redis: {} }));
vi.mock('../../src/conversacion/almacen.js', () => ({ marcarAtendidos: async () => undefined }));
vi.mock('../../src/ingesta/dedup.js', () => ({ yaProcesado: async () => false }));
vi.mock('../../src/ingesta/buffer.js', () => ({
  agregarAlBuffer: async (m: { contenido: string }) => ({ mensajes: [m], textoAgrupado: m.contenido, clienteId: 'c1', chatwootConversationId: 7 }),
}));
vi.mock('../../src/ingesta/esperaCandado.js', () => ({ conCandadoEsperando: async () => ({ ok: false }) }));
vi.mock('../../src/ingesta/atenderTurno.js', () => ({ atenderTurno: vi.fn(), manejarFalloDeTurno: vi.fn() }));
vi.mock('../../src/salida/alertaEquipo.js', () => ({ alertarAlEquipo: alertar }));

const { procesarEntrante } = await import('../../src/ingesta/procesarEntrante.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('procesarEntrante con el candado agotado', () => {
  it('deja nota y aviso al equipo, abriendo la conversación', async () => {
    await procesarEntrante({ id: 'c1', chatwootAccountId: 1 } as never, {
      evento: 'message_created', direccion: 'entrante', privado: false, messageId: 11, conversationId: 7, accountId: 1,
      contactId: 5, telefono: '573001234567', remitenteTipo: 'contact', remitenteId: 5, contenido: 'ya pagué', estado: null,
      errorExterno: null, adjuntos: [],
    } as never);
    expect(alertar).toHaveBeenCalledWith(expect.anything(), 7, expect.stringContaining('ya pagué'), { abrir: true });
  });
});
