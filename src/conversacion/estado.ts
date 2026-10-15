import { supabase } from '../db/supabase.js';
import type { ClienteConfig, Idioma } from '../types/index.js';

async function actualizar(cfg: ClienteConfig, conversationId: number, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('conversaciones').update(cambios)
    .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', conversationId);
  if (error) throw new Error(`Error actualizando la conversación: ${error.message}`);
}

/**
 * Pausa el bot (escaló o respondió una persona). El bot NO vuelve solo: ni por tiempo, ni al resolver, ni al
 * desasignar. Solo la nota privada «#max» de una persona lo libera (ver ingesta/liberacion.ts, D-08).
 */
export const pausarBot = (cfg: ClienteConfig, conversationId: number, motivo: string) =>
  actualizar(cfg, conversationId, { estado_bot: 'pausado', escalado_at: new Date().toISOString(), motivo_escalamiento: motivo });
/** Liberación explícita (nota «#max»). Es la única forma de reactivar. */
export const reactivarBot = (cfg: ClienteConfig, conversationId: number) =>
  actualizar(cfg, conversationId, { estado_bot: 'activo', reactivado_at: new Date().toISOString() });
export const guardarIdioma = (cfg: ClienteConfig, conversationId: number, idioma: Idioma) =>
  actualizar(cfg, conversationId, { idioma });

/** Estado actual en la base. Se revisa justo antes de enviar, por si una persona tomó la conversación. */
export async function estaPausado(cfg: ClienteConfig, conversacionId: string): Promise<boolean> {
  const { data, error } = await supabase.from('conversaciones').select('estado_bot')
    .eq('cliente_id', cfg.id).eq('id', conversacionId).maybeSingle();
  if (error) throw new Error(`Error leyendo el estado del bot: ${error.message}`);
  return (data as { estado_bot?: string } | null)?.estado_bot === 'pausado';
}

/** Cuándo y por qué quedó pausado el bot (sirve para distinguir su propia pausa de la de una persona). */
export async function leerPausa(cfg: ClienteConfig, conversacionId: string): Promise<{ escaladoAt: string | null; motivo: string | null }> {
  const { data, error } = await supabase.from('conversaciones')
    .select('escalado_at, motivo_escalamiento').eq('cliente_id', cfg.id).eq('id', conversacionId).maybeSingle();
  if (error) throw new Error(`Error leyendo la pausa: ${error.message}`);
  const f = data as { escalado_at: string | null; motivo_escalamiento: string | null } | null;
  return { escaladoAt: f?.escalado_at ?? null, motivo: f?.motivo_escalamiento ?? null };
}
