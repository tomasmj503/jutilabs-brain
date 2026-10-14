import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, secretoPorRef } from '../config/env.js';
import { cargarClientePorChatwootAccount, cargarClientePorSlug } from '../config/cliente.js';
import type { ClienteConfig } from '../types/index.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';
import { leerAviso, type Aviso } from './aviso.js';
import { procesarEntrante } from './procesarEntrante.js';
import { procesarSaliente } from './procesarSaliente.js';
import { registrarEnCurso } from './enCurso.js';
import { procesarActualizacion } from './revisarFallo.js';
import { esEntranteGuardable, guardarEntranteDurable, recibirConBotApagado } from './bandeja.js';
import { alertarAlEquipo } from '../salida/alertaEquipo.js';

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
  if (a.direccion !== 'entrante') return;
  // Kill-switch (bot_activo = false): el bot no atiende al huésped, pero su mensaje se guarda y la conversación se abre
  // para el equipo (#18). Antes se descartaba sin dejar rastro.
  if (cfg.botActivo) await procesarEntrante(cfg, a);
  else await recibirConBotApagado(cfg, a);
}

/** Tope para el guardado previo al 200: si Supabase tarda más, se responde igual (el camino asíncrono lo guarda). */
const TOPE_GUARDADO_ANTES_DEL_200_MS = 4_000;

/**
 * Bandeja durable: el mensaje del huésped queda en la base ANTES de responder 200. Best-effort: si falla o tarda,
 * se responde 200 igual (Chatwoot no debe reintentar) y el camino asíncrono lo vuelve a intentar al procesarlo.
 */
async function guardarAntesDelOk(aviso: Aviso, cfgDeLaRuta: ClienteConfig | null): Promise<void> {
  if (!esEntranteGuardable(aviso) || aviso.accountId === null) return;
  try {
    const cfg = cfgDeLaRuta ?? await cargarClientePorChatwootAccount(aviso.accountId);
    if (!cfg || !cfg.activo) return;
    let reloj: NodeJS.Timeout | undefined;
    const tope = new Promise<void>((resolver) => {
      reloj = setTimeout(resolver, TOPE_GUARDADO_ANTES_DEL_200_MS);
    });
    await Promise.race([guardarEntranteDurable(cfg, aviso, !cfg.botActivo), tope]);
    clearTimeout(reloj);
  } catch (e) {
    console.error(`BANDEJA: no se pudo guardar antes del 200 conv=${aviso.conversationId} mensaje=${aviso.messageId}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * #19: si el procesamiento de un mensaje del huésped revienta, no basta con el log: nota privada + aviso al equipo.
 * Best-effort (sin configuración del cliente o sin Chatwoot no hay a quién avisar); el mensaje ya quedó guardado
 * sin atender y el barrido de la bandeja lo retoma.
 */
async function avisarFalloDeEntrada(aviso: Aviso, cfgDeLaRuta: ClienteConfig | null, causa: unknown): Promise<void> {
  if (aviso.direccion !== 'entrante' || aviso.privado || aviso.conversationId === null || aviso.accountId === null) return;
  try {
    const cfg = cfgDeLaRuta ?? await cargarClientePorChatwootAccount(aviso.accountId);
    if (!cfg || !cfg.activo) return;
    const motivo = causa instanceof Error ? causa.message.slice(0, 120) : 'error desconocido';
    await alertarAlEquipo(cfg, aviso.conversationId,
      `⚠️ El bot no pudo procesar un mensaje del huésped (${motivo}). Revisa la conversación y respóndele tú; `
      + 'el bot volverá a intentarlo en unos minutos.\nMensaje del huésped: "' + enmascararSensibles(aviso.contenido).slice(0, 300) + '"',
      { abrir: true });
  } catch (e) {
    console.error(`NO SE PUDO AVISAR EL FALLO DE ENTRADA conv=${aviso.conversationId}:`, e instanceof Error ? e.message : e);
  }
}

async function aceptar(req: FastifyRequest, reply: FastifyReply, cfgDeLaRuta: ClienteConfig | null): Promise<FastifyReply> {
  const aviso = leerAviso(req.body);
  if ((aviso.evento === 'message_created' || aviso.evento === 'message_updated') && aviso.accountId !== null && aviso.conversationId !== null) {
    await guardarAntesDelOk(aviso, cfgDeLaRuta);
    // Se anota como "en curso": si el cerebro se apaga, espera a que termine (ver src/apagado.ts).
    registrarEnCurso(despachar({ ...aviso, accountId: aviso.accountId }, cfgDeLaRuta).catch((e) => {
      console.error('Falló el procesamiento del aviso:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
      return avisarFalloDeEntrada(aviso, cfgDeLaRuta, e);
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
    return await aceptar(req, reply, cfg);
  });

  // Ruta vieja: secreto global. Se conserva temporalmente; el cliente sale del account_id del cuerpo.
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) return reply.code(401).send({ ok: false });
    console.warn('WEBHOOK RUTA OBSOLETA /webhook/chatwoot (secreto global): migrar Chatwoot a /webhook/chatwoot/<slug> con secreto propio');
    return await aceptar(req, reply, null);
  });
}
