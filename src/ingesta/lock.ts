import { randomUUID } from 'node:crypto';
import { redis } from '../db/redis.js';
import { env } from '../config/env.js';

// Solo suelta el candado si sigue siendo nuestro (así no borra el de otro turno si el nuestro venció).
const SOLTAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Corre fn si nadie más está atendiendo esta conversación. Si está ocupada, devuelve null sin correr nada. */
export async function conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T | null> {
  const claveRedis = `lock:${clave}`;
  const dueno = randomUUID();
  const obtenido = await redis.set(claveRedis, dueno, 'PX', env.LOCK_TTL_MS, 'NX');
  if (obtenido === null) return null;
  try {
    return await fn();
  } finally {
    await redis.eval(SOLTAR, 1, claveRedis, dueno).catch(() => undefined);
  }
}
