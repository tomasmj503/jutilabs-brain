import { supabase } from '../db/supabase.js';
import type { ClienteConfig, Idioma } from '../types/index.js';

const TTL_MS = 60_000;
const cache = new Map<number, { cfg: ClienteConfig | null; expira: number }>();

export async function cargarClientePorChatwootAccount(chatwootAccountId: number): Promise<ClienteConfig | null> {
  const enCache = cache.get(chatwootAccountId);
  if (enCache && enCache.expira > Date.now()) return enCache.cfg;

  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('chatwoot_account_id', chatwootAccountId)
    .maybeSingle();

  if (error) throw new Error(`Error leyendo cliente: ${error.message}`);

  const cfg: ClienteConfig | null = data
    ? {
      id: data.id,
      slug: data.slug,
      nombre: data.nombre,
      activo: data.activo,
      botActivo: data.bot_activo,
      chatwootAccountId: data.chatwoot_account_id,
      chatwootTokenRef: data.chatwoot_token_ref,
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
    }
    : null;

  cache.set(chatwootAccountId, { cfg, expira: Date.now() + TTL_MS });
  return cfg;
}