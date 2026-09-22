import { redis } from '../db/redis.js';
import { leerPausa } from '../conversacion/estado.js';

const UN_DIA = 24 * 60 * 60;

/**
 * True UNA sola vez por pausa, y solo si el bot escaló por sí mismo (no sabía el dato o falló).
 * Si una persona ya está atendiendo, el bot no interrumpe.
 */
export async function debeAcusar(conversacionId: string): Promise<boolean> {
  const { escaladoAt, motivo } = await leerPausa(conversacionId);
  if (!escaladoAt || !motivo || motivo === 'agente_respondio') return false;
  const primera = await redis.set(`acuse:${conversacionId}:${escaladoAt}`, '1', 'EX', UN_DIA, 'NX');
  return primera !== null;
}
