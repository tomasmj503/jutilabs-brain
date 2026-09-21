import { describe, it, expect, vi, beforeEach } from 'vitest';
import { llamadas, limpiar } from './redisFalso.js';

vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalso.js')).redisFalso }));

import { yaProcesado } from '../../src/ingesta/dedup.js';

describe('dedup', () => {
  beforeEach(() => limpiar());

  it('la primera vez que llega un mensaje no está procesado', async () => {
    expect(await yaProcesado('cliente-1', 100)).toBe(false);
  });

  it('el mismo mensaje por segunda vez ya está procesado', async () => {
    await yaProcesado('cliente-1', 100);
    expect(await yaProcesado('cliente-1', 100)).toBe(true);
  });

  it('el mismo número en otro cliente no cuenta como repetido', async () => {
    await yaProcesado('cliente-1', 100);
    expect(await yaProcesado('cliente-2', 100)).toBe(false);
  });

  it('recuerda el mensaje 24 horas', async () => {
    await yaProcesado('cliente-1', 100);
    expect(llamadas[0]).toEqual(['dedup:cliente-1:100', '1', 'EX', 86400, 'NX']);
  });
});
