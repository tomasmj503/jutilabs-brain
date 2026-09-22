import { describe, it, expect, vi, beforeEach } from 'vitest';
import { limpiarBuffer } from './redisFalsoBuffer.js';

vi.mock('../../src/config/env.js', () => ({ env: { BUFFER_MS: 20 } }));
vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalsoBuffer.js')).redisFalsoBuffer }));

import { agregarAlBuffer } from '../../src/ingesta/buffer.js';

export const nuevo = (id: number, texto: string, conv = 1) => ({
  clienteId: 'cli-1', chatwootAccountId: 1, chatwootConversationId: conv, chatwootContactId: 5,
  chatwootMessageId: id, canal: 'whatsapp' as const, telefono: null, contenido: texto,
  tipo: 'texto' as const, recibidoAt: '2026-09-20T00:00:00Z',
});

describe('buffer', () => {
  beforeEach(() => limpiarBuffer());

  it('un mensaje solo se entrega como un turno de un mensaje', async () => {
    const turno = await agregarAlBuffer(nuevo(1, 'hola'));
    expect(turno?.mensajes).toHaveLength(1);
    expect(turno?.textoAgrupado).toBe('hola');
  });

  it('mensajes seguidos se entregan juntos, una sola vez', async () => {
    const r = await Promise.all([agregarAlBuffer(nuevo(1, 'hola')), agregarAlBuffer(nuevo(2, 'quiero reservar'))]);
    const turnos = r.filter((t) => t !== null);
    expect(turnos).toHaveLength(1);
    expect(turnos[0]?.textoAgrupado).toBe('hola\nquiero reservar');
  });
});
