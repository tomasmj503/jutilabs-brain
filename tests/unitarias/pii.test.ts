import { describe, it, expect, vi, beforeEach } from 'vitest';

// #16 / PC-19: «4111 1111 1111 1111» no llega a la base, a la nota, al modelo ni al log; el log no trae el teléfono completo.
const turnos: Array<{ mensajes: Array<{ contenido: string }>; textoAgrupado: string }> = [];
vi.mock('../../src/config/env.js', () => ({ env: { BUFFER_MS: 0 }, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/redis.js', () => ({ redis: {} }));
vi.mock('../../src/conversacion/almacen.js', () => ({ marcarAtendidos: async () => undefined }));
vi.mock('../../src/ingesta/dedup.js', () => ({ yaProcesado: async () => false }));
vi.mock('../../src/ingesta/buffer.js', () => ({
  agregarAlBuffer: async (m: { contenido: string }) => ({ mensajes: [m], textoAgrupado: m.contenido, clienteId: 'c1', chatwootConversationId: 7 }),
}));
vi.mock('../../src/ingesta/esperaCandado.js', () => ({
  conCandadoEsperando: async (_k: string, f: () => Promise<unknown>) => ({ ok: true, valor: await f() }),
}));
vi.mock('../../src/ingesta/atenderTurno.js', () => ({
  atenderTurno: async (_c: unknown, t: (typeof turnos)[number]) => { turnos.push(t); return { atendido: true }; },
  manejarFalloDeTurno: vi.fn(),
}));

const { procesarEntrante } = await import('../../src/ingesta/procesarEntrante.js');
const { leerAviso } = await import('../../src/ingesta/aviso.js');

const cfg = { id: 'c1', chatwootAccountId: 1 } as never;
const aviso = (contenido: string) => ({
  evento: 'message_created', direccion: 'entrante', privado: false, messageId: 11, conversationId: 7, accountId: 1,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'contact', remitenteId: 5, contenido, estado: null,
  errorExterno: null, adjuntos: [],
} as never);

describe('PII', () => {
  beforeEach(() => { turnos.length = 0; vi.restoreAllMocks(); });

  it('procesarEntrante enmascara tarjeta y clave ANTES del buffer (lo guardado, la nota y el modelo ya vienen limpios)', async () => {
    await procesarEntrante(cfg, aviso('mi tarjeta es 4111 1111 1111 1111 y mi clave es Secreta99'));
    expect(turnos).toHaveLength(1);
    const t = turnos[0]!;
    expect(t.textoAgrupado).not.toMatch(/4111|Secreta99/);
    expect(t.mensajes[0]!.contenido).not.toMatch(/4111|Secreta99/);
  });

  it('el log del aviso no trae el teléfono completo ni el texto', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    leerAviso({
      event: 'message_created', message_type: 'incoming', id: 1, content: 'tarjeta 4111 1111 1111 1111',
      sender: { id: 7, type: 'contact', phone_number: '+57 300 123 4567' }, conversation: { id: 42 }, account: { id: 1 },
    });
    const salida = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(salida).not.toContain('573001234567');
    expect(salida).not.toMatch(/4111/);
    expect(salida).toContain('4567');
  });
});
