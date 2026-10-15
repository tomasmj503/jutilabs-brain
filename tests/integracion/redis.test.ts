import { describe, it, expect, afterAll } from 'vitest';
import { crearRedisDePrueba } from './entorno.js';

const redis = crearRedisDePrueba();
afterAll(() => redis.quit());

// Lo que el Redis falso de tests/unitarias NO modela: vencimiento real y Lua (base de ADR-11 / PC-14).
describe('Redis real', () => {
  it('SET NX PX: el segundo no lo obtiene y el valor vence solo', async () => {
    expect(await redis.set('int:ttl', 'a', 'PX', 150, 'NX')).toBe('OK');
    expect(await redis.set('int:ttl', 'b', 'PX', 150, 'NX')).toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(await redis.get('int:ttl')).toBeNull();
  });

  it('un script Lua solo renueva si el dueño coincide', async () => {
    const RENOVAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
    await redis.set('int:lua', 'yo', 'PX', 1000);
    expect(await redis.eval(RENOVAR, 1, 'int:lua', 'otro', '5000')).toBe(0);
    expect(await redis.eval(RENOVAR, 1, 'int:lua', 'yo', '5000')).toBe(1);
    expect(await redis.pttl('int:lua')).toBeGreaterThan(1000);
  });
});
