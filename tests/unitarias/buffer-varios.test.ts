import { describe, it, expect, vi, beforeEach } from 'vitest';
import { limpiarBuffer } from './redisFalsoBuffer.js';

vi.mock('../../src/config/env.js', () => ({ env: { BUFFER_MS: 20 } }));
vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalsoBuffer.js')).redisFalsoBuffer }));

import { agregarAlBuffer } from '../../src/ingesta/buffer.js';

const nuevo = (id: number, texto: string, conv = 1) => ({
  clienteId: 'cli-1', chatwootAccountId: 1, chatwootConversationId: conv, chatwootContactId: 5,
  chatwootMessageId: id, canal: 'whatsapp' as const, telefono: null, contenido: texto,
  tipo: 'texto' as const, recibidoAt: '2026-09-20T00:00:00Z',
});

describe('buffer, varias conversaciones y turnos', () => {
  beforeEach(() => limpiarBuffer());

  it('conversaciones distintas no se mezclan', async () => {
    const r = await Promise.all([agregarAlBuffer(nuevo(1, 'a', 1)), agregarAlBuffer(nuevo(2, 'b', 2))]);
    expect(r.map((t) => t?.textoAgrupado).sort()).toEqual(['a', 'b']);
  });

  it('un mensaje posterior empieza un turno nuevo', async () => {
    await agregarAlBuffer(nuevo(1, 'primero'));
    const segundo = await agregarAlBuffer(nuevo(2, 'segundo'));
    expect(segundo?.textoAgrupado).toBe('segundo');
  });
});
