import { randomUUID } from 'node:crypto';
import { redis } from '../db/redis.js';
import { env } from '../config/env.js';

// Solo suelta el candado si sigue siendo nuestro (así no borra el de otro turno si el nuestro venció).
const SOLTAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
// Solo renueva si sigue siendo nuestro. Devuelve 1 si renovó, 0 si ya no era nuestro.
const RENOVAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

/** Cada cuánto se renueva el candado mientras el turno vive: 30 s, o un tercio del vencimiento si es más corto. */
export function intervaloDeRenovacionMs(ttlMs: number): number {
  return Math.max(10, Math.min(30_000, Math.floor(ttlMs / 3)));
}

/** El candado visto desde dentro del turno. */
export interface Candado {
  /**
   * ¿El candado sigue siendo nuestro? Se pregunta a Redis, no a la memoria. Si no se puede confirmar (Redis caído)
   * devuelve false: ante la duda, el turno NO envía (ADR-11 / PC-14).
   */
  sigueSiendoMio(): Promise<boolean>;
}

/**
 * Corre fn si nadie más está atendiendo esta conversación. Si está ocupada, devuelve null sin correr nada.
 * Mientras fn corre, el candado se RENUEVA (ADR-11): un turno largo ya no deja correr un segundo turno en paralelo.
 */
export async function conCandado<T>(clave: string, fn: (candado: Candado) => Promise<T>): Promise<T | null> {
  const claveRedis = `lock:${clave}`;
  const dueno = randomUUID();
  const ttl = env.LOCK_TTL_MS;
  const obtenido = await redis.set(claveRedis, dueno, 'PX', ttl, 'NX');
  if (obtenido === null) return null;

  let perdido = false;
  const reloj = setInterval(() => {
    void (async () => {
      try {
        const r = await redis.eval(RENOVAR, 1, claveRedis, dueno, String(ttl));
        if (r === 0) {
          perdido = true;
          console.error(`CANDADO PERDIDO ${clave}: venció o lo tomó otro turno`);
        }
      } catch (e) {
        // Un tropiezo de Redis no prueba que se perdió: se reintenta en la próxima vuelta; antes de enviar se confirma.
        console.error(`CANDADO: no se pudo renovar ${clave}:`, e instanceof Error ? e.message : e);
      }
    })();
  }, intervaloDeRenovacionMs(ttl));
  reloj.unref();

  const candado: Candado = {
    async sigueSiendoMio() {
      if (perdido) return false;
      try {
        return (await redis.get(claveRedis)) === dueno;
      } catch {
        return false;
      }
    },
  };
  try {
    return await fn(candado);
  } finally {
    clearInterval(reloj);
    await redis.eval(SOLTAR, 1, claveRedis, dueno).catch(() => undefined);
  }
}
