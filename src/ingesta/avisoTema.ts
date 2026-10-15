import { redis } from '../db/redis.js';

/** Un tema de la lista avisa al equipo una vez por ventana y por conversación, no en cada mensaje. */
export const VENTANA_TEMA_SEGUNDOS = 600;

/**
 * True solo la primera vez dentro de la ventana para esa conversación y ese tema. Si Redis falla devuelve true:
 * es mejor un aviso de más que ninguno.
 */
export async function debeAvisarTema(conversacionId: string, tema: string): Promise<boolean> {
  try {
    const primera = await redis.set(`tema:${conversacionId}:${tema}`, '1', 'EX', VENTANA_TEMA_SEGUNDOS, 'NX');
    return primera !== null;
  } catch (e) {
    console.error(`AVISO DE TEMA: no se pudo consultar la ventana (se avisa igual) conv=${conversacionId}:`, e instanceof Error ? e.message : e);
    return true;
  }
}
