import { supabase } from '../db/supabase.js';
import type { ClienteConfig, ContextoConversacion, Idioma } from '../types/index.js';

/** True si la pausa ya cumplió las horas de espera (sin fecha de pausa = se reactiva). */
export function debeReactivar(escaladoAt: string | null, horas: number, ahora: Date = new Date()): boolean {
  if (!escaladoAt) return true;
  return ahora.getTime() - new Date(escaladoAt).getTime() >= horas * 3_600_000;
}

async function actualizar(cfg: ClienteConfig, conversationId: number, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('conversaciones').update(cambios)
    .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', conversationId);
  if (error) throw new Error(`Error actualizando la conversación: ${error.message}`);
}

/** Pausa el bot (escaló o respondió una persona). Cada pausa reinicia la cuenta de horas. */
export const pausarBot = (cfg: ClienteConfig, conversationId: number, motivo: string) =>
  actualizar(cfg, conversationId, { estado_bot: 'pausado', escalado_at: new Date().toISOString(), motivo_escalamiento: motivo });
export const reactivarBot = (cfg: ClienteConfig, conversationId: number) =>
  actualizar(cfg, conversationId, { estado_bot: 'activo', reactivado_at: new Date().toISOString() });
export const guardarIdioma = (cfg: ClienteConfig, conversationId: number, idioma: Idioma) =>
  actualizar(cfg, conversationId, { idioma });

/** Si el bot está pausado y ya pasaron las horas, lo reactiva. Solo consulta la base cuando está pausado. */
export async function aplicarReactivacion(cfg: ClienteConfig, ctx: ContextoConversacion): Promise<ContextoConversacion> {
  if (ctx.estadoBot !== 'pausado') return ctx;
  const { data, error } = await supabase.from('conversaciones').select('escalado_at').eq('id', ctx.id).maybeSingle();
  if (error) throw new Error(`Error leyendo la pausa: ${error.message}`);
  const desde = (data as { escalado_at: string | null } | null)?.escalado_at ?? null;
  if (!debeReactivar(desde, cfg.reactivacionHoras)) return ctx;
  await reactivarBot(cfg, ctx.chatwootConversationId);
  return { ...ctx, estadoBot: 'activo' };
}

/** Estado actual en la base. Se revisa justo antes de enviar, por si una persona tomó la conversación. */
export async function estaPausado(conversacionId: string): Promise<boolean> {
  const { data, error } = await supabase.from('conversaciones').select('estado_bot').eq('id', conversacionId).maybeSingle();
  if (error) throw new Error(`Error leyendo el estado del bot: ${error.message}`);
  return (data as { estado_bot?: string } | null)?.estado_bot === 'pausado';
}
