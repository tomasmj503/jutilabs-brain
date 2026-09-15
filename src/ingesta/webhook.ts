import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

/**
 * POST /webhook/chatwoot
 * Contrato: responde 200 en < 200 ms SIEMPRE (Chatwoot reintenta si no). El procesamiento es asíncrono.
 * Pasos (ver §11.4 en Notion): validar secreto → filtrar solo message_created de contacto (no de agente)
 * → mapear a MensajeEntrante → dedup → buffer → procesar bajo candado.
 * TODO(qwen3-coder-plus): implementar. No bloquear la respuesta con await de la cadena.
 */
export async function registrarWebhookChatwoot(app: FastifyInstance): Promise<void> {
  app.post('/webhook/chatwoot', async (req, reply) => {
    if (req.headers['x-jutilabs-secret'] !== env.CHATWOOT_WEBHOOK_SECRET) {
      return reply.code(401).send({ ok: false });
    }
    // TODO: encolar procesamiento sin await
    return reply.code(200).send({ ok: true });
  });
}
