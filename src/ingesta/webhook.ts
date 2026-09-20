import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { cargarClientePorChatwootAccount } from '../config/cliente.js';
import { enviarMensaje } from '../salida/chatwoot.js';

/**
 * POST /webhook/chatwoot
 * Contrato: responde 200 en < 200 ms SIEMPRE (Chatwoot reintenta si no). El procesamiento es asíncrono.
 * Pasos (ver §11.4 en Notion): validar secreto → filtrar solo message_created de contacto (no de agente)
 * → mapear a MensajeEntrante → dedup → buffer → procesar bajo candado.
 *
 * VERSIÓN TEMPORAL: la configuración del cliente ya viene de Supabase, pero la respuesta sigue siendo
 * una frase fija. Sin IA todavía.
 * TEMPORAL: el secreto llega en la URL (?secret=...) porque Chatwoot no permite encabezados propios.
 * Pendiente: cambiar a la firma oficial de Chatwoot (X-Chatwoot-Signature).
 */

type CuerpoChatwoot = {
  event?: string;
  message_type?: string;
  conversation?: { id?: number };
  account?: { id?: number };
};

/** Compara dos textos sin filtrar información por el tiempo que tarda la comparación. */
function secretosIguales(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

function leerSecreto(encabezado: string | string[] | undefined, query: unknown): string | undefined {
  const deEncabezado = Array.isArray(encabezado) ? encabezado[0] : encabezado;
  if (deEncabezado) return deEncabezado;
  const deUrl = (query as { secret?: unknown } | null)?.secret;
  return typeof deUrl === 'string' ? deUrl : undefined;
}

export async function registrarWebhookChatwoot(app: FastifyInstance): Promise<void> {
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) {
      return reply.code(401).send({ ok: false });
    }

    const cuerpo = (req.body ?? {}) as CuerpoChatwoot;
    const conversationId = cuerpo.conversation?.id;
    const accountId = cuerpo.account?.id;

    // Solo mensajes que ENTRAN del cliente. Si no, el bot se respondería a sí mismo sin parar.
    if (
      cuerpo.event === 'message_created' &&
      cuerpo.message_type === 'incoming' &&
      conversationId &&
      accountId
    ) {
      void (async () => {
        const cfg = await cargarClientePorChatwootAccount(accountId);
        // Kill-switch: cliente desconocido, inactivo o con el bot apagado → se ignora.
        if (!cfg || !cfg.activo || !cfg.botActivo) return;
        await enviarMensaje(cfg, conversationId, 'hola, recibido');
      })().catch((e) => {
        console.error('Falló el procesamiento del mensaje:', e instanceof Error ? e.message : e);
      });
    }

    return reply.code(200).send({ ok: true });
  });
}
