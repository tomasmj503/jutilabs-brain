import { supabase } from '../db/supabase.js';
import type { ClienteConfig, Idioma } from '../types/index.js';

const TTL_MS = 60_000;
const REINTENTO_TRAS_FALLA_MS = 10_000;
const cache = new Map<number, { cfg: ClienteConfig | null; expira: number }>();
const cachePorSlug = new Map<string, { cfg: ClienteConfig | null; expira: number }>();

const leerFila = (columna: string, valor: string | number) =>
  supabase.from('clientes').select('*').eq(columna, valor).maybeSingle();
/** Fila de `clientes` tal como la devuelve Supabase (select '*'): el cliente no tiene tipos generados. */
type FilaCliente = NonNullable<Awaited<ReturnType<typeof leerFila>>['data']>;

function aConfig(data: FilaCliente): ClienteConfig {
  return {
    id: data.id,
    slug: data.slug,
    nombre: data.nombre,
    activo: data.activo,
    botActivo: data.bot_activo,
    chatwootAccountId: data.chatwoot_account_id,
    chatwootTokenRef: data.chatwoot_token_ref,
    chatwootWebhookSecretRef: data.chatwoot_webhook_secret_ref ?? null,
    chatwootBotSecretRef: data.chatwoot_bot_secret_ref ?? null,
    chatwootBotTokenRef: data.chatwoot_bot_token_ref ?? null,
    idiomas: data.idiomas as Idioma[],
    idiomaDefault: data.idioma_default as Idioma,
    zonaHoraria: data.zona_horaria,
    nombreBot: data.nombre_bot,
    promptBase: data.prompt_base ?? '',
    temasEnAlcance: data.temas_en_alcance,
    temasQueEscalan: data.temas_que_escalan,
    contactosEscalamiento: data.contactos_escalamiento,
    llmModelo: data.llm_modelo,
    llmModeloRespaldo: data.llm_modelo_respaldo,
    llmTemperatura: Number(data.llm_temperatura),
    openrouterKeyRef: data.openrouter_key_ref,
    limiteMensajesDiaConversacion: data.limite_mensajes_dia_conversacion,
    reactivacionHoras: data.reactivacion_horas,
    linkReservaBase: data.link_reserva_base,
    configExtra: {
      ...(data.config_extra ?? {}),
      tono: data.tono,
      mensajeEscalamiento: data.mensaje_escalamiento,
      mensajeNoSeElDato: data.mensaje_no_se_el_dato,
      limiteGastoUsdDia: data.limite_gasto_usd_dia,
    },
  };
}

/**
 * Lee un cliente por una columna única y lo guarda en caché. Si Supabase falla pero ya lo conocíamos, sigue con
 * la última configuración conocida (en vez de dejar al huésped sin respuesta) y reintenta en 10 s.
 */
async function cargarConCache<K>(
  cacheDe: Map<K, { cfg: ClienteConfig | null; expira: number }>, clave: K, columna: string, valor: string | number,
): Promise<ClienteConfig | null> {
  const enCache = cacheDe.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.cfg;

  const { data, error } = await leerFila(columna, valor);

  if (error) {
    if (enCache?.cfg) {
      console.warn(`CONFIG DEL CLIENTE: Supabase falló (${error.message}), se usa la última conocida`);
      cacheDe.set(clave, { cfg: enCache.cfg, expira: Date.now() + REINTENTO_TRAS_FALLA_MS });
      return enCache.cfg;
    }
    throw new Error(`Error leyendo cliente: ${error.message}`);
  }

  const cfg = data ? aConfig(data) : null;
  cacheDe.set(clave, { cfg, expira: Date.now() + TTL_MS });
  return cfg;
}

export const cargarClientePorChatwootAccount = (chatwootAccountId: number) =>
  cargarConCache(cache, chatwootAccountId, 'chatwoot_account_id', chatwootAccountId);

/** Cliente por su slug (ruta /webhook/chatwoot/:slug). */
export const cargarClientePorSlug = (slug: string) => cargarConCache(cachePorSlug, slug, 'slug', slug);

/** Todos los clientes activos (para trabajadores que recorren a todos, como el barrido de la bandeja). */
export async function cargarClientesActivos(): Promise<ClienteConfig[]> {
  const { data, error } = await supabase.from('clientes').select('*').eq('activo', true);
  if (error) throw new Error(`Error leyendo clientes activos: ${error.message}`);
  return ((data ?? []) as FilaCliente[]).map(aConfig);
}
