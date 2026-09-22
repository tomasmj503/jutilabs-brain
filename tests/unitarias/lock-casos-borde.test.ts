import { describe, it, expect, vi, beforeEach } from 'vitest';
import { almacen, limpiar } from './redisFalso.js';

vi.mock('../../src/config/env.js', () => ({ env: { LOCK_TTL_MS: 60000 } }));
vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalso.js')).redisFalso }));

import { conCandado } from '../../src/ingesta/lock.js';

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('candado, casos límite', () => {
  beforeEach(() => limpiar());

  it('conversaciones distintas no se bloquean entre sí', async () => {
    let terminar = () => {};
    const primera = conCandado('c1', () => new Promise<string>((r) => { terminar = () => r('a'); }));
    await esperar();
    expect(await conCandado('c2', async () => 'b')).toBe('b');
    terminar();
    await primera;
  });

  it('no suelta un candado que ya es de otro turno', async () => {
    await conCandado('c1', async () => { almacen.set('lock:c1', 'otro-turno'); });
    expect(almacen.get('lock:c1')).toBe('otro-turno');
  });
});
