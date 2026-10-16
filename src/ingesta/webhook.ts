import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, secretoPorRef } from '../config/env.js';
import { modoAgentBot } from '../config/agentBot.js';
import { cargarClientePorChatwootAccount, cargarClientePorSlug } from '../config/cliente.js';
import type { ClienteConfig } from '../types/index.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';
import { leerAviso, type Aviso } from './aviso.js';
import { procesarEntrante } from './procesarEntrante.js';
import { procesarSaliente } from './procesarSaliente.js';
import { esComandoLiberar, procesarLiberacion } from './liberacion.js';
import { registrarEnCurso } from './enCurso.js';
import { procesarActualizacion } from './revisarFallo.js';
import { esEntranteGuardable, guardarEntranteDurable, recibirConBotApagado } from './bandeja.js';
import { alertarAlEquipo } from '../salida/alertaEquipo.js';

/**
 * Webhooks de Chatwoot. Responden 200 al instante SIEMPRE que el aviso es legítimo (si no, Chatwoot reintenta: solo
 * lo hace con 429 o 500, y su tiempo límite es de 5 s).
 *  - POST /webhook/chatwoot/:slug  → ligado a su account_id. Se autentica con la FIRMA del Agent Bot
 *    (X-Chatwoot-Signature = "sha256=" + HMAC-SHA256(secreto_del_bot, `${X-Chatwoot-Timestamp}.${cuerpo crudo}`), con el
 *    timestamp a ≤ 5 min) o, mientras dura la transición, con el secreto PROPIO del cliente (≥ 32 caracteres).
 *  - POST /webhook/chatwoot        → secreto global (obsoleta, se conserva mientras se migra la configuración de Chatwoot).
 * Mensaje del huésped: dedup → buffer → candado → router → modelo. Con Agent Bot (chatwootBotTokenRef) solo se atiende si
 * la conversación está en "pending"; en "open" (o cualquier otro estado) se guarda y NO se responde: la tiene una persona.
 * Mensaje de una persona del equipo: pausa el bot (y, con Agent Bot, abre la conversación). Los del propio bot se ignoran.
 * message_updated: avisa al equipo si Meta rechazó un mensaje ya aceptado (ver revisarFallo.ts).
 * TEMPORAL: el secreto viejo llega en la URL (?secret=...) o en el encabezado x-jutilabs-secret; se retira cuando
 * Chatwoot ya firme todos los avisos.
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

/** Diferencia máxima entre el reloj de Chatwoot (X-Chatwoot-Timestamp) y el nuestro; pasada, la firma se rechaza (repetición). */
export const TOLERANCIA_FIRMA_MS = 5 * 60_000;

export type ResultadoFirma = 'ok' | 'sin-firma' | 'timestamp-invalido' | 'timestamp-viejo' | 'firma-invalida';

/**
 * Firma oficial de Chatwoot: "sha256=" + HMAC-SHA256(secreto, `${timestamp}.${cuerpo crudo}`). Se firma el cuerpo TAL CUAL
 * llegó (bytes), no el JSON re-serializado. La comparación es en tiempo constante.
 */
export function verificarFirma(
  secreto: string, timestamp: string | undefined, firma: string | undefined, cuerpoCrudo: Buffer, ahoraMs: number = Date.now(),
): ResultadoFirma {
  if (!timestamp || !firma) return 'sin-firma';
  if (!/^\d{1,13}$/.test(timestamp)) return 'timestamp-invalido';
  const ts = Number(timestamp);
  const tsMs = ts < 1e12 ? ts * 1000 : ts; // segundos (lo normal) o milisegundos
  if (Math.abs(ahoraMs - tsMs) > TOLERANCIA_FIRMA_MS) return 'timestamp-viejo';
  const esperada = 'sha256=' + createHmac('sha256', secreto).update(`${timestamp}.`).update(cuerpoCrudo).digest('hex');
  return secretosIguales(firma, esperada) ? 'ok' : 'firma-invalida';
}

const encabezado = (valor: string | string[] | undefined): string | undefined => (Array.isArray(valor) ? valor[0] : valor);

/** ¿La petición trae una firma válida del Agent Bot de ESTE cliente? Registra el motivo si no. */
function firmaDelBotValida(slug: string, cfg: ClienteConfig, req: FastifyRequest, cuerpoCrudo: Buffer): boolean {
  const firma = encabezado(req.headers['x-chatwoot-signature']);
  if (!firma) return false; // sin firma: solo queda el secreto viejo
  if (!cfg.chatwootBotSecretRef) return false; // el cliente aún no tiene secreto del bot: se prueba el secreto viejo
  let secreto: string;
  try {
    secreto = secretoPorRef(cfg.chatwootBotSecretRef);
  } catch (e) {
    console.error(`WEBHOOK slug=${slug}: secreto del bot no configurado (${cfg.chatwootBotSecretRef}):`, e instanceof Error ? e.message : e);
    return false;
  }
  const resultado = verificarFirma(secreto, encabezado(req.headers['x-chatwoot-timestamp']), firma, cuerpoCrudo);
  if (resultado !== 'ok') console.warn(`WEBHOOK slug=${slug}: firma rechazada (${resultado})`);
  return resultado === 'ok';
}

/** ¿Trae el secreto propio del cliente (x-jutilabs-secret / ?secret)? Es el mecanismo anterior a la firma. */
function secretoViejoValido(slug: string, cfg: ClienteConfig, req: FastifyRequest): boolean {
  if (!cfg.chatwootWebhookSecretRef) return false;
  let esperado: string;
  try {
    esperado = secretoPorRef(cfg.chatwootWebhookSecretRef);
  } catch (e) {
    console.error(`WEBHOOK slug=${slug}: secreto no configurado (${cfg.chatwootWebhookSecretRef}):`, e instanceof Error ? e.message : e);
    return false;
  }
  if (esperado.length < LARGO_MINIMO_SECRETO) {
    console.error(`WEBHOOK slug=${slug}: el secreto configurado tiene menos de ${LARGO_MINIMO_SECRETO} caracteres; se rechaza todo hasta corregirlo`);
    return false;
  }
  return secretosIguales(leerSecreto(req.headers['x-jutilabs-secret'], req.query), esperado);
}

/**
 * ¿Este aviso se le contesta al huésped? Si el bot está activo y, en modo Agent Bot (chatwootBotTokenRef), la conversación
 * está en "pending". Sin Agent Bot no hay regla de estado: se atiende como siempre.
 */
const sePuedeAtender = (cfg: ClienteConfig, a: Aviso): boolean =>
  cfg.botActivo && (!modoAgentBot(cfg) || a.estadoConversacion === 'pending');

/**
 * Conversación que NO está en "pending" (la tiene una persona, o está resuelta/pospuesta): el mensaje se guarda ya
 * atendido (si no, el barrido de la bandeja se lo contestaría a los 3 min) y no se responde.
 */
async function recibirSinAtender(cfg: ClienteConfig, a: Aviso): Promise<void> {
  console.log(`ENTRANTE SIN ATENDER conv=${a.conversationId} mensaje=${a.messageId}: la conversación está en "${a.estadoConversacion ?? 'sin estado'}", no en "pending"`);
  try {
    await guardarEntranteDurable(cfg, a, true);
  } catch (e) {
    console.error(`SIN ATENDER: no se pudo guardar el mensaje conv=${a.conversationId}:`, e instanceof Error ? e.message : e);
  }
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
  if (a.direccion === 'saliente') {
    // D-08: la nota privada «#max» de una persona devuelve el chat a Max; es lo ÚNICO que lo libera.
    if (esComandoLiberar(a)) return procesarLiberacion(cfg, a);
    return procesarSaliente(cfg, a);
  }
  if (a.direccion !== 'entrante') return;
  // Kill-switch (bot_activo = false): el bot no atiende al huésped, pero su mensaje se guarda y la conversación se abre
  // para el equipo (#18). Antes se descartaba sin dejar rastro.
  if (!cfg.botActivo) return recibirConBotApagado(cfg, a);
  // Con Agent Bot solo se atienden conversaciones "pending": en "open" ya hay una persona (en la edición community su
  // respuesta no la pasa sola de pending a open, por eso procesarSaliente la abre).
  if (sePuedeAtender(cfg, a)) return procesarEntrante(cfg, a);
  return recibirSinAtender(cfg, a);
}

/** Tope para el guardado previo al 200: Chatwoot espera 5 s; si Supabase tarda más, se responde igual (el camino asíncrono lo guarda). */
const TOPE_GUARDADO_ANTES_DEL_200_MS = 1_500;

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
    await Promise.race([guardarEntranteDurable(cfg, aviso, !sePuedeAtender(cfg, aviso)), tope]);
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

async function aceptar(cuerpo: unknown, reply: FastifyReply, cfgDeLaRuta: ClienteConfig | null): Promise<FastifyReply> {
  const aviso = leerAviso(cuerpo);
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
  // Ruta nueva. Va en su propio contexto de Fastify para que SOLO ella reciba el cuerpo crudo (Buffer): la firma se
  // calcula sobre esos bytes. El JSON se interpreta después de autenticar, nunca antes.
  await app.register(async (rutaFirmada) => {
    rutaFirmada.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, cuerpo, hecho) => hecho(null, cuerpo));

    // Todo rechazo es un 401 igual (no revela qué clientes existen).
    rutaFirmada.post<{ Params: { slug: string } }>('/webhook/chatwoot/:slug', async (req, reply) => {
      const rechazar = () => reply.code(401).send({ ok: false });
      const { slug } = req.params;
      const cuerpoCrudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let cfg: ClienteConfig | null;
      try {
        cfg = await cargarClientePorSlug(slug);
      } catch (e) {
        console.error(`WEBHOOK slug=${slug}: no se pudo cargar el cliente:`, e instanceof Error ? e.message : e);
        return rechazar();
      }
      if (!cfg) return rechazar();
      // Cualquiera de las dos pruebas basta; con firma válida no hace falta el secreto viejo.
      const metodo = firmaDelBotValida(slug, cfg, req, cuerpoCrudo) ? 'firma' : secretoViejoValido(slug, cfg, req) ? 'secreto-viejo' : null;
      if (!metodo) return rechazar();
      let cuerpo: unknown;
      try {
        cuerpo = JSON.parse(cuerpoCrudo.toString('utf8'));
      } catch {
        return reply.code(400).send({ ok: false });
      }
      // El secreto (o la firma) de un cliente solo vale para SU cuenta de Chatwoot (PC-22).
      if (accountIdDelCuerpo(cuerpo) !== cfg.chatwootAccountId) return rechazar();
      const entrega = (encabezado(req.headers['x-chatwoot-delivery']) ?? '-').slice(0, 64);
      console.log(`WEBHOOK slug=${slug} autenticado=${metodo} entrega=${entrega}`);
      return await aceptar(cuerpo, reply, cfg);
    });
  });

  // Ruta vieja: secreto global. Se conserva temporalmente; el cliente sale del account_id del cuerpo.
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) return reply.code(401).send({ ok: false });
    console.warn('WEBHOOK RUTA OBSOLETA /webhook/chatwoot (secreto global): migrar Chatwoot a /webhook/chatwoot/<slug> con secreto propio');
    return await aceptar(req.body, reply, null);
  });
}
