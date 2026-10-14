import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, secretoPorRef } from '../config/env.js';
import { cargarClientePorChatwootAccount, cargarClientePorSlug } from '../config/cliente.js';
import type { ClienteConfig } from '../types/index.js';
import { leerAviso, type Aviso } from './aviso.js';
import { procesarEntrante } from './procesarEntrante.js';
import { procesarSaliente } from './procesarSaliente.js';
import { registrarEnCurso } from './enCurso.js';
import { procesarActualizacion } from './revisarFallo.js';

/**
 * Webhooks de Chatwoot. Responden 200 al instante SIEMPRE que el aviso es legítimo (si no, Chatwoot reintenta).
 *  - POST /webhook/chatwoot/:slug  → secreto PROPIO del cliente (≥ 32 caracteres), ligado a su account_id. Es la ruta nueva.
 *  - POST /webhook/chatwoot        → secreto global (obsoleta, se conserva mientras se migra la configuración de Chatwoot).
 * Mensaje del huésped: dedup → buffer → candado → router → modelo.
 * Mensaje de una persona del equipo: pausa el bot.
 * message_updated: avisa al equipo si Meta rechazó un mensaje ya aceptado (ver revisarFallo.ts).
 * TEMPORAL: el secreto llega en la URL (?secret=...) o en el encabezado x-jutilabs-secret. Pendiente: firma oficial
 * X-Chatwoot-Signature (S-04: confirmar si Chatwoot 4.17.0 la ofrece).
 */

/** Largo mínimo del secreto de un cliente (ADR-06). */
export const LARGO_MINIMO_SECRETO = 32;

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

/**
 * `cfgDeLaRuta` viene cuando la ruta ya identificó al cliente (/:slug): ese cliente manda y el account_id del
 * aviso ya se comprobó contra él. Sin él (ruta vieja) el cliente se busca por el account_id del cuerpo.
 */
async function despachar(a: Aviso & { accountId: number }, cfgDeLaRuta: ClienteConfig | null): Promise<void> {
  const cfg = cfgDeLaRuta ?? await cargarClientePorChatwootAccount(a.accountId);
  // Cliente desconocido o dado de baja (activo = false) → se ignora todo.
  if (!cfg || !cfg.activo) return;
  if (a.evento === 'message_updated') return procesarActualizacion(cfg, a); // ¿Meta rechazó un mensaje?
  // Las respuestas del equipo se registran SIEMPRE (pausan el bot), aunque el bot esté apagado:
  // así, al volver a prenderlo, no le contesta encima a una persona que estaba atendiendo.
  if (a.direccion === 'saliente') return procesarSaliente(cfg, a);
  // Kill-switch (bot_activo = false): el bot no atiende al huésped.
  if (a.direccion === 'entrante' && cfg.botActivo) await procesarEntrante(cfg, a);
}

function aceptar(req: FastifyRequest, reply: FastifyReply, cfgDeLaRuta: ClienteConfig | null): FastifyReply {
  const aviso = leerAviso(req.body);
  if ((aviso.evento === 'message_created' || aviso.evento === 'message_updated') && aviso.accountId !== null && aviso.conversationId !== null) {
    // Se anota como "en curso": si el cerebro se apaga, espera a que termine (ver src/apagado.ts).
    registrarEnCurso(despachar({ ...aviso, accountId: aviso.accountId }, cfgDeLaRuta).catch((e) => {
      console.error('Falló el procesamiento del aviso:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    }));
  }
  return reply.code(200).send({ ok: true });
}

/** account_id del cuerpo sin interpretar el resto (la ruta por cliente lo exige igual al del cliente). */
function accountIdDelCuerpo(cuerpo: unknown): number | null {
  const id = ((cuerpo as { account?: { id?: unknown } } | null)?.account)?.id;
  return typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null;
}

export async function registrarWebhookChatwoot(app: FastifyInstance): Promise<void> {
  // Ruta nueva: un secreto por cliente. Todo rechazo es un 401 igual (no revela qué clientes existen).
  app.post<{ Params: { slug: string } }>('/webhook/chatwoot/:slug', async (req, reply) => {
    const rechazar = () => reply.code(401).send({ ok: false });
    const { slug } = req.params;
    let cfg: ClienteConfig | null;
    try {
      cfg = await cargarClientePorSlug(slug);
    } catch (e) {
      console.error(`WEBHOOK slug=${slug}: no se pudo cargar el cliente:`, e instanceof Error ? e.message : e);
      return rechazar();
    }
    if (!cfg?.chatwootWebhookSecretRef) return rechazar();
    let esperado: string;
    try {
      esperado = secretoPorRef(cfg.chatwootWebhookSecretRef);
    } catch (e) {
      console.error(`WEBHOOK slug=${slug}: secreto no configurado (${cfg.chatwootWebhookSecretRef}):`, e instanceof Error ? e.message : e);
      return rechazar();
    }
    if (esperado.length < LARGO_MINIMO_SECRETO) {
      console.error(`WEBHOOK slug=${slug}: el secreto configurado tiene menos de ${LARGO_MINIMO_SECRETO} caracteres; se rechaza todo hasta corregirlo`);
      return rechazar();
    }
    if (!secretosIguales(leerSecreto(req.headers['x-jutilabs-secret'], req.query), esperado)) return rechazar();
    // El secreto de un cliente solo vale para SU cuenta de Chatwoot (PC-22).
    if (accountIdDelCuerpo(req.body) !== cfg.chatwootAccountId) return rechazar();
    return aceptar(req, reply, cfg);
  });

  // Ruta vieja: secreto global. Se conserva temporalmente; el cliente sale del account_id del cuerpo.
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) return reply.code(401).send({ ok: false });
    console.warn('WEBHOOK RUTA OBSOLETA /webhook/chatwoot (secreto global): migrar Chatwoot a /webhook/chatwoot/<slug> con secreto propio');
    return aceptar(req, reply, null);
  });
}
