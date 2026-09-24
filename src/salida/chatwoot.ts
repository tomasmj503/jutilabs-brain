import type { ClienteConfig } from '../types/index.js';
import { env, secretoPorRef } from '../config/env.js';
import { clasificarFalloDeRed, crearFetch, dormir, esFalloDeRed } from '../red/reintento.js';
import { EnvioIncierto, ErrorChatwoot } from './errores.js';

// Llamadas que se pueden repetir sin daño (nota interna, estado, perfil): límite de 8 s y hasta 3 intentos.
// OJO: enviar el mensaje al huésped NO usa esto (un reintento a ciegas puede duplicar el WhatsApp).
const fetchSeguro = crearFetch({ nombre: 'chatwoot', politica: 'segura', timeoutMs: 8_000 });
// Envío al huésped: solo se repite si el error prueba que la petición nunca salió (ej. EAI_AGAIN).
const fetchEnvio = crearFetch({ nombre: 'chatwoot-envio', politica: 'solo-si-no-salio', timeoutMs: 10_000 });

const ESPERA_ANTES_DE_VERIFICAR_MS = 2_000; // deja terminar a Chatwoot si seguía procesando el envío
const TOLERANCIA_RELOJ_MS = 1_500;

async function llamarChatwoot(
  cfg: ClienteConfig,
  conversationId: number,
  ruta: string,
  cuerpo: Record<string, unknown>,
  hacerFetch: typeof fetch = fetch,
): Promise<Response> {
  const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/${ruta}`;

  const respuesta = await hacerFetch(url, {
    method: 'POST',
    headers: {
      // Con guion, no guion bajo: Caddy descarta los encabezados con guion bajo.
      'api-access-token': secretoPorRef(cfg.chatwootTokenRef),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new ErrorChatwoot(`Chatwoot respondió ${respuesta.status} en ${ruta}: ${detalle.slice(0, 200)}`, respuesta.status);
  }
  return respuesta;
}

class RespuestaSinId extends Error {}

async function enviarUnaVez(cfg: ClienteConfig, conversationId: number, texto: string): Promise<number> {
  const respuesta = await llamarChatwoot(cfg, conversationId, 'messages', {
    content: texto,
    message_type: 'outgoing',
    private: false,
  }, fetchEnvio);
  const datos = (await respuesta.json()) as { id?: number };
  if (typeof datos.id !== 'number') throw new RespuestaSinId('Chatwoot no devolvió el id del mensaje');
  return datos.id;
}

/** True si el error NO descarta que Chatwoot haya creado el mensaje (y por tanto salga al huésped). */
function puedeHaberSalido(e: unknown): boolean {
  if (e instanceof ErrorChatwoot) return e.estado >= 500; // un 4xx = Chatwoot lo rechazó, no se creó
  if (e instanceof RespuestaSinId || e instanceof SyntaxError) return true; // respondió, pero sin poder leerse
  return esFalloDeRed(e) && clasificarFalloDeRed(e) === 'quiza-salio';
}

export type ResultadoVerificacion =
  | { estado: 'encontrado'; id: number }
  | { estado: 'no-encontrado' }
  | { estado: 'dudoso' }
  | { estado: 'no-se' };

type MensajeApi = { id?: unknown; content?: unknown; message_type?: unknown; private?: unknown; created_at?: unknown };

const normalizar = (t: string) => t.replace(/\s+/g, ' ').trim();

function esSalienteReciente(m: MensajeApi, desdeMs: number): boolean {
  if (m.message_type !== 1 && m.message_type !== 'outgoing') return false;
  if (m.private === true) return false;
  if (typeof m.created_at !== 'number') return true; // sin fecha: por prudencia se cuenta
  const ms = m.created_at < 1e12 ? m.created_at * 1000 : m.created_at;
  return ms >= desdeMs - TOLERANCIA_RELOJ_MS;
}

/**
 * Pregunta a Chatwoot si el mensaje ya quedó creado. Solo devuelve "no-encontrado" (que permite
 * reenviar) si la respuesta llegó bien formada y no hay NINGÚN mensaje saliente nuevo.
 * Cualquier duda ("dudoso", "no-se") significa: no reenviar.
 */
export async function verificarEnvio(
  cfg: ClienteConfig, conversationId: number, texto: string, desdeMs: number,
): Promise<ResultadoVerificacion> {
  try {
    const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
    const url = `${base}/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/messages`;
    const r = await fetchSeguro(url, { headers: { 'api-access-token': secretoPorRef(cfg.chatwootTokenRef) } });
    if (!r.ok) return { estado: 'no-se' };
    const json = (await r.json()) as unknown;
    const lista = Array.isArray(json) ? json : (json as { payload?: unknown } | null)?.payload;
    if (!Array.isArray(lista)) return { estado: 'no-se' };
    const nuevos = (lista as MensajeApi[]).filter((m) => esSalienteReciente(m, desdeMs));
    const buscado = normalizar(texto);
    const igual = nuevos.find((m) => typeof m.content === 'string' && typeof m.id === 'number' && normalizar(m.content) === buscado);
    if (igual) return { estado: 'encontrado', id: igual.id as number };
    return nuevos.length > 0 ? { estado: 'dudoso' } : { estado: 'no-encontrado' };
  } catch {
    return { estado: 'no-se' };
  }
}

export type EstadoMensaje =
  | { estado: 'fallido'; error: string | null; contenido: string }
  | { estado: 'ok' }
  | { estado: 'no-encontrado' }
  | { estado: 'no-se' };

type MensajeConEstado = MensajeApi & { status?: unknown; content_attributes?: unknown };

/**
 * Pregunta a Chatwoot en qué estado quedó un mensaje (sent | delivered | read | failed). Es lectura pura: se puede
 * repetir sin daño. No confía en el aviso (message_updated puede no traer el estado en 4.17.0): la verdad es la API.
 * Solo mira los últimos mensajes de la conversación (la API los entrega en páginas de 20).
 */
export async function consultarEstadoMensaje(cfg: ClienteConfig, conversationId: number, messageId: number): Promise<EstadoMensaje> {
  try {
    const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
    const url = `${base}/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/messages`;
    const r = await fetchSeguro(url, { headers: { 'api-access-token': secretoPorRef(cfg.chatwootTokenRef) } });
    if (!r.ok) return { estado: 'no-se' };
    const json = (await r.json()) as unknown;
    const lista = Array.isArray(json) ? json : (json as { payload?: unknown } | null)?.payload;
    if (!Array.isArray(lista)) return { estado: 'no-se' };
    const m = (lista as MensajeConEstado[]).find((x) => x.id === messageId);
    if (!m) return { estado: 'no-encontrado' };
    if (typeof m.status !== 'string') return { estado: 'no-se' }; // sin estado no se afirma nada
    if (m.status !== 'failed') return { estado: 'ok' };
    const attrs = (m.content_attributes && typeof m.content_attributes === 'object' ? m.content_attributes : {}) as { external_error?: unknown };
    const error = typeof attrs.external_error === 'string' && attrs.external_error.trim() ? attrs.external_error.trim().slice(0, 300) : null;
    return { estado: 'fallido', error, contenido: typeof m.content === 'string' ? m.content : '' };
  } catch {
    return { estado: 'no-se' };
  }
}

/**
 * Envía un mensaje al huésped SIN riesgo de duplicarlo. Devuelve el id del mensaje en Chatwoot.
 *  - Si el error prueba que nada salió (ej. EAI_AGAIN): reintenta solo (dentro de fetchEnvio).
 *  - Si no se sabe si salió (corte, tiempo agotado, 5xx): primero mira en Chatwoot. Si ya está, no lo
 *    reenvía; si de verdad no está, lo reenvía UNA vez; si no se puede saber, lanza EnvioIncierto.
 *  - Si Chatwoot lo rechazó (4xx) o nunca se pudo conectar: lanza el error normal (no salió nada).
 */
export async function enviarMensaje(cfg: ClienteConfig, conversationId: number, texto: string): Promise<number> {
  const desdeMs = Date.now();
  for (let envio = 1; envio <= 2; envio++) {
    try {
      return await enviarUnaVez(cfg, conversationId, texto);
    } catch (e) {
      if (!puedeHaberSalido(e)) throw e;
      console.warn(`ENVÍO AMBIGUO conv=${conversationId} envio=${envio}: ${e instanceof Error ? e.message : e} → se verifica en Chatwoot antes de reintentar`);
      await dormir(ESPERA_ANTES_DE_VERIFICAR_MS);
      const v = await verificarEnvio(cfg, conversationId, texto, desdeMs);
      if (v.estado === 'encontrado') {
        console.warn(`ENVÍO CONFIRMADO conv=${conversationId} mensaje=${v.id}: sí había salido, no se reenvía`);
        return v.id;
      }
      if (v.estado === 'no-encontrado') {
        if (envio === 2) throw e;
        console.warn(`ENVÍO NO LLEGÓ conv=${conversationId}: se reenvía una vez`);
        continue;
      }
      console.error(`ENVÍO INCIERTO conv=${conversationId} verificación=${v.estado}: NO se reenvía`);
      throw new EnvioIncierto(v.estado, e);
    }
  }
  throw new Error('enviarMensaje: flujo inalcanzable');
}

/** Nota interna: solo la ve el equipo, nunca el huésped. */
export async function enviarNotaPrivada(cfg: ClienteConfig, conversationId: number, texto: string): Promise<void> {
  await llamarChatwoot(cfg, conversationId, 'messages', {
    content: texto,
    message_type: 'outgoing',
    private: true,
  }, fetchSeguro);
}

/**
 * Deja la conversación "abierta": en Chatwoot es el estado que el equipo ve en la lista por defecto.
 * ("Pendiente" significa que un bot la está atendiendo.)
 */
export async function marcarAbierta(cfg: ClienteConfig, conversationId: number): Promise<void> {
  await llamarChatwoot(cfg, conversationId, 'toggle_status', { status: 'open' }, fetchSeguro);
}

const idsDelBot = new Map<string, number>();

/** Id del usuario "bot" en Chatwoot (dueño del token). Se consulta una vez y se recuerda. */
export async function idUsuarioBot(cfg: ClienteConfig): Promise<number | null> {
  const guardado = idsDelBot.get(cfg.id);
  if (guardado !== undefined) return guardado;
  const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
  const r = await fetchSeguro(`${base}/api/v1/profile`, {
    headers: { 'api-access-token': secretoPorRef(cfg.chatwootTokenRef) },
  });
  if (!r.ok) throw new Error(`Chatwoot respondió ${r.status} al pedir el perfil del bot`);
  const id = ((await r.json()) as { id?: unknown }).id;
  if (typeof id !== 'number') return null;
  idsDelBot.set(cfg.id, id);
  return id;
}
