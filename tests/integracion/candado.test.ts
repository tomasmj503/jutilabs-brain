import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { redisConInterruptor } from './entorno.js';

// INT-CANDADO (ADR-11 / PC-14): Redis REAL, LOCK_TTL_MS = 2000 y un turno de 5 s (más largo que el vencimiento).
const { redis, estado } = redisConInterruptor();
vi.mock('../../src/config/env.js', () => ({ env: { LOCK_TTL_MS: 2000 } }));
vi.mock('../../src/db/redis.js', () => ({ get redis() { return redis; } }));

const { conCandado } = await import('../../src/ingesta/lock.js');
const { conCandadoEsperando } = await import('../../src/ingesta/esperaCandado.js');

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(async () => {
  estado.caido = false;
  const k = await redis.keys('lock:*');
  if (k.length) await redis.del(...k);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => redis.quit());

describe('candado renovable con Redis real', () => {
  it('un turno de 5 s con candado de 2 s NO deja correr un segundo turno en paralelo', async () => {
    const eventos: string[] = [];
    const largo = conCandado('c1', async () => {
      eventos.push('A empieza');
      await dormir(5_000);
      eventos.push('A termina');
      return 'a';
    });
    await dormir(2_600); // ya pasó el vencimiento original (2 s): sin renovación otro turno lo tomaría
    const segundo = await conCandado('c1', async () => { eventos.push('B corrió'); return 'b'; });
    expect(segundo).toBeNull();
    expect(await largo).toBe('a');
    expect(eventos).toEqual(['A empieza', 'A termina']);
  }, 15_000);

  it('conCandadoEsperando: el segundo turno ESPERA y corre después, sin solaparse', async () => {
    const eventos: string[] = [];
    const a = conCandadoEsperando('c2', async () => { eventos.push('A+'); await dormir(3_000); eventos.push('A-'); });
    await dormir(100);
    const b = conCandadoEsperando('c2', async () => { eventos.push('B+'); eventos.push('B-'); }, 15_000);
    await Promise.all([a, b]);
    expect(eventos).toEqual(['A+', 'A-', 'B+', 'B-']);
  }, 20_000);

  it('sigueSiendoMio: true mientras es nuestro; false si otro lo tomó o Redis no responde', async () => {
    await conCandado('c3', async (c) => {
      expect(await c.sigueSiendoMio()).toBe(true);
      await redis.set('lock:c3', 'otro-turno', 'PX', 5_000); // lo roban
      expect(await c.sigueSiendoMio()).toBe(false);
    });
    await conCandado('c4', async (c) => {
      estado.caido = true;
      expect(await c.sigueSiendoMio()).toBe(false); // no se puede confirmar → no se envía
      estado.caido = false;
    });
  });

  it('la renovación detecta que el candado se perdió y lo marca', async () => {
    await conCandado('c5', async (c) => {
      await redis.del('lock:c5');
      await redis.set('lock:c5', 'otro', 'PX', 10_000);
      await dormir(1_000); // al menos una vuelta de renovación (2000/3 ≈ 666 ms)
      expect(await c.sigueSiendoMio()).toBe(false);
    });
    // y no borra el candado del otro al terminar
    expect(await redis.get('lock:c5')).toBe('otro');
  }, 10_000);
});
