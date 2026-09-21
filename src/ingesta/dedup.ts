import { redis } from '../db/redis.js';

const TTL_SEGUNDOS = 24 * 60 * 60;

/** True si este mensaje ya se vio antes (Chatwoot a veces reenvía el mismo aviso). Se recuerda 24 h. */
export async function yaProcesado(clienteId: string, chatwootMessageId: number): Promise<boolean> {
  const clave = `dedup:${clienteId}:${chatwootMessageId}`;
  const resultado = await redis.set(clave, '1', 'EX', TTL_SEGUNDOS, 'NX');
  return resultado === null;
}
