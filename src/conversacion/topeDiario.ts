import { supabase } from '../db/supabase.js';
import type { ClienteConfig } from '../types/index.js';

/** Medianoche de hoy en la zona horaria del cliente, como instante exacto. */
export function inicioDelDia(zona: string, ahora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ahora);
  const n = (t: string) => Number(partes.find((x) => x.type === t)?.value);
  const relojLocal = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  const desfase = relojLocal - Math.floor(ahora.getTime() / 1000) * 1000;
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day')) - desfase);
}

/** Cuántos mensajes envió el bot en esta conversación desde `desde`. */
export async function contarMensajesDelBot(conversacionId: string, desde: Date): Promise<number> {
  const { count, error } = await supabase.from('mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('conversacion_id', conversacionId).eq('rol', 'bot')
    .gte('created_at', desde.toISOString());
  if (error) throw new Error(`Error contando mensajes del bot: ${error.message}`);
  return count ?? 0;
}

/**
 * True si el bot ya llegó al tope diario de mensajes en esta conversación (clientes.limite_mensajes_dia_conversacion).
 * Si no se puede contar, NO frena: es un freno de gasto, y frenar por un error de red escalaría a todos.
 */
export async function llegoAlTope(cfg: ClienteConfig, conversacionId: string, ahora: Date = new Date()): Promise<boolean> {
  try {
    const n = await contarMensajesDelBot(conversacionId, inicioDelDia(cfg.zonaHoraria, ahora));
    return n >= cfg.limiteMensajesDiaConversacion;
  } catch (e) {
    console.error(`TOPE DIARIO: no se pudo contar conv=${conversacionId}, se responde igual:`, e instanceof Error ? e.message : e);
    return false;
  }
}
