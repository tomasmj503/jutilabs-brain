import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { cargarClientePorChatwootAccount } from '../config/cliente.js';
import { leerAviso, type Aviso } from './aviso.js';
import { procesarEntrante } from './procesarEntrante.js';
import { procesarSaliente } from './procesarSaliente.js';

/**
 * POST /webhook/chatwoot: responde 200 al instante SIEMPRE (si no, Chatwoot reintenta).
 * Mensaje del huésped: dedup → buffer → candado → router → modelo.
 * Mensaje de una persona del equipo: pausa el bot.
 * TEMPORAL: el secreto llega en la URL (?secret=...). Pendiente: firma oficial X-Chatwoot-Signature.
 */

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

async function despachar(a: Aviso & { accountId: number }): Promise<void> {
  const cfg = await cargarClientePorChatwootAccount(a.accountId);
  // Kill-switch: cliente desconocido, inactivo o con el bot apagado → se ignora.
  if (!cfg || !cfg.activo || !cfg.botActivo) return;
  if (a.direccion === 'entrante') await procesarEntrante(cfg, a);
  else if (a.direccion === 'saliente') await procesarSaliente(cfg, a);
}

export async function registrarWebhookChatwoot(app: FastifyInstance): Promise<void> {
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) return reply.code(401).send({ ok: false });
    const aviso = leerAviso(req.body);
    if (aviso.evento === 'message_created' && aviso.accountId !== null && aviso.conversationId !== null) {
      void despachar({ ...aviso, accountId: aviso.accountId }).catch((e) => {
        console.error('Falló el procesamiento del aviso:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
      });
    }
    return reply.code(200).send({ ok: true });
  });
}
