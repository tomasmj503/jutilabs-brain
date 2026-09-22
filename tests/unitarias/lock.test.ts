import { describe, it, expect, vi, beforeEach } from 'vitest';
import { almacen, limpiar } from './redisFalso.js';

vi.mock('../../src/config/env.js', () => ({ env: { LOCK_TTL_MS: 60000 } }));
vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalso.js')).redisFalso }));

import { conCandado } from '../../src/ingesta/lock.js';

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('candado', () => {
  beforeEach(() => limpiar());

  it('corre la función, devuelve su resultado y suelta el candado', async () => {
    expect(await conCandado('c1', async () => 'listo')).toBe('listo');
    expect(almacen.size).toBe(0);
  });

  it('si la conversación está ocupada, devuelve null y no corre nada', async () => {
    let terminar = () => {};
    const primera = conCandado('c1', () => new Promise<string>((r) => { terminar = () => r('a'); }));
    await esperar();
    const segunda = vi.fn(async () => 'b');
    expect(await conCandado('c1', segunda)).toBeNull();
    expect(segunda).not.toHaveBeenCalled();
    terminar();
    expect(await primera).toBe('a');
  });

  it('suelta el candado aunque la función falle', async () => {
    await expect(conCandado('c1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await conCandado('c1', async () => 'ok')).toBe('ok');
  });
});
