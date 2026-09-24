import { redis } from '../db/redis.js';

const TTL_SEGUNDOS = 24 * 60 * 60;

/** True si este mensaje ya se vio antes (Chatwoot a veces reenvía el mismo aviso). Se recuerda 24 h. */
export async function yaProcesado(clienteId: string, chatwootMessageId: number): Promise<boolean> {
  const clave = `dedup:${clienteId}:${chatwootMessageId}`;
  const resultado = await redis.set(clave, '1', 'EX', TTL_SEGUNDOS, 'NX');
  return resultado === null;
}

const TTL_FALLO_SEGUNDOS = 30 * 24 * 60 * 60;
const claveFallo = (clienteId: string, chatwootMessageId: number) => `fallo:${clienteId}:${chatwootMessageId}`;

/** True si es la PRIMERA vez que se avisa de este mensaje fallido (así se avisa una sola vez por mensaje). */
export async function marcarFalloAvisado(clienteId: string, chatwootMessageId: number): Promise<boolean> {
  const r = await redis.set(claveFallo(clienteId, chatwootMessageId), '1', 'EX', TTL_FALLO_SEGUNDOS, 'NX');
  return r !== null;
}

/** Deshace la marca si el aviso al equipo no pudo salir, para que un aviso posterior lo intente de nuevo. */
export async function desmarcarFalloAvisado(clienteId: string, chatwootMessageId: number): Promise<void> {
  await redis.del(claveFallo(clienteId, chatwootMessageId));
}
