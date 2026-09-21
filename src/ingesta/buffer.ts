import { redis } from '../db/redis.js';
import { env } from '../config/env.js';
import type { MensajeEntrante, TurnoEntrante } from '../types/index.js';

const TTL_SEGUNDOS = 600;
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Junta los mensajes seguidos de una conversación. Cada mensaje espera BUFFER_MS; si llega otro
 * mientras tanto, el anterior se retira (devuelve null) y el último entrega todo junto.
 */
export async function agregarAlBuffer(msg: MensajeEntrante): Promise<TurnoEntrante | null> {
  const clave = `buffer:${msg.clienteId}:${msg.chatwootConversationId}`;
  const claveTurno = `${clave}:n`;
  await redis.rpush(clave, JSON.stringify(msg));
  await redis.expire(clave, TTL_SEGUNDOS);
  const miNumero = await redis.incr(claveTurno);
  await redis.expire(claveTurno, TTL_SEGUNDOS);
  await esperar(env.BUFFER_MS);

  // Si llegó otro mensaje después del mío, él se encarga de entregar.
  if ((await redis.get(claveTurno)) !== String(miNumero)) return null;

  const resultado = await redis.multi().lrange(clave, 0, -1).del(clave).exec();
  const crudos = (resultado?.[0]?.[1] ?? []) as string[];
  if (crudos.length === 0) return null;

  const mensajes = crudos.map((c) => JSON.parse(c) as MensajeEntrante);
  return {
    clienteId: msg.clienteId,
    chatwootConversationId: msg.chatwootConversationId,
    mensajes,
    textoAgrupado: mensajes.map((m) => m.contenido).join('\n'),
  };
}
