import { supabase } from '../db/supabase.js';
import type { ClienteConfig } from '../types/index.js';

/**
 * Aviso al equipo que NO se pudo confirmar (PC-15). Se guarda en la conversación (columnas aviso_pendiente y
 * aviso_pendiente_at, migración 0002) para que el barrido de la bandeja lo reintente. Mientras esté pendiente:
 *   · no se le escribió al huésped que «el equipo ya fue avisado»;
 *   · el bot NO se pausó (nadie sabe que hay una solicitud);
 *   · el mensaje del huésped sigue sin `atendido_at`.
 * Cuando el aviso por fin sale, el barrido completa lo que faltaba (pausar y/o texto al huésped).
 * Si Supabase mismo está caído, el pendiente vive en la memoria de este proceso (también se reintenta y se cuenta
 * en /health/ready). Límite honesto: si además el proceso muere, no hay dónde persistirlo.
 */
export type AvisoPendiente = {
  nota: string;
  /** MotivoEscalamiento u otro rótulo ('operativa', 'tema', 'mensaje_fallido'). */
  motivo: string;
  /** Al confirmarse el aviso, pausar el bot con este motivo. */
  pausar: boolean;
  /** Texto fijo para el huésped que solo se envía cuando el aviso quedó confirmado (null = ninguno). */
  textoHuesped: string | null;
  idioma: string;
  /** La nota privada ya quedó creada (no repetirla). */
  notaCreada: boolean;
  /** ISO de cuándo se intentó avisar por primera vez. */
  desde: string;
};

export type EntradaPendiente = {
  conversationId: number;
  /** Id interno de la conversación, si la fila existe. */
  conversacionId: string | null;
  aviso: AvisoPendiente;
};

const enMemoria = new Map<string, EntradaPendiente>();
const claveMem = (cfg: ClienteConfig, conversationId: number) => `${cfg.id}:${conversationId}`;

/** Pendientes que viven solo en memoria (Supabase estaba caído al registrarlos). */
export function pendientesEnMemoria(cfg: ClienteConfig): EntradaPendiente[] {
  return [...enMemoria.entries()].filter(([k]) => k.startsWith(`${cfg.id}:`)).map(([, v]) => v);
}

export async function registrarAvisoPendiente(
  cfg: ClienteConfig, conversationId: number, aviso: Omit<AvisoPendiente, 'desde'>,
): Promise<void> {
  const completo: AvisoPendiente = { ...aviso, desde: new Date().toISOString() };
  try {
    // Si ya había uno pendiente se conserva el más viejo (el reloj de los 15 min no se reinicia).
    const { data, error } = await supabase.from('conversaciones')
      .update({ aviso_pendiente: completo, aviso_pendiente_at: completo.desde })
      .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', conversationId).is('aviso_pendiente_at', null)
      .select('id');
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length === 0) {
      const ya = await supabase.from('conversaciones').select('aviso_pendiente_at')
        .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', conversationId).maybeSingle();
      if (ya.error) throw new Error(ya.error.message);
      if (!ya.data) throw new Error('la conversación no existe todavía');
    }
  } catch (e) {
    console.error(`AVISO PENDIENTE: no se pudo guardar en la base conv=${conversationId} (queda en memoria):`, e instanceof Error ? e.message : e);
    if (!enMemoria.has(claveMem(cfg, conversationId))) {
      enMemoria.set(claveMem(cfg, conversationId), { conversationId, conversacionId: null, aviso: completo });
    }
  }
}

export async function leerAvisosPendientes(cfg: ClienteConfig, limite = 50): Promise<EntradaPendiente[]> {
  const { data, error } = await supabase.from('conversaciones')
    .select('id, chatwoot_conversation_id, aviso_pendiente')
    .eq('cliente_id', cfg.id).not('aviso_pendiente_at', 'is', null).limit(limite);
  if (error) throw new Error(`Error leyendo avisos pendientes: ${error.message}`);
  const deBase = ((data ?? []) as Array<{ id: string; chatwoot_conversation_id: number; aviso_pendiente: AvisoPendiente | null }>)
    .filter((f) => f.aviso_pendiente)
    .map((f) => ({ conversationId: f.chatwoot_conversation_id, conversacionId: f.id, aviso: f.aviso_pendiente as AvisoPendiente }));
  return [...deBase, ...pendientesEnMemoria(cfg)];
}

export async function actualizarAvisoPendiente(cfg: ClienteConfig, e: EntradaPendiente, cambios: Partial<AvisoPendiente>): Promise<void> {
  const nuevo = { ...e.aviso, ...cambios };
  const mem = enMemoria.get(claveMem(cfg, e.conversationId));
  if (mem) {
    enMemoria.set(claveMem(cfg, e.conversationId), { ...mem, aviso: nuevo });
    return;
  }
  const { error } = await supabase.from('conversaciones').update({ aviso_pendiente: nuevo })
    .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', e.conversationId);
  if (error) throw new Error(`Error actualizando el aviso pendiente: ${error.message}`);
}

export async function limpiarAvisoPendiente(cfg: ClienteConfig, conversationId: number): Promise<void> {
  enMemoria.delete(claveMem(cfg, conversationId));
  const { error } = await supabase.from('conversaciones').update({ aviso_pendiente: null, aviso_pendiente_at: null })
    .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', conversationId);
  if (error) throw new Error(`Error limpiando el aviso pendiente: ${error.message}`);
}

/** Cuántos avisos llevan más de `masViejosQueMs` sin confirmarse (base + memoria). Para /health/ready. */
export async function contarAvisosSinConfirmar(cfg: ClienteConfig, masViejosQueMs: number, ahora: Date = new Date()): Promise<number> {
  const limite = new Date(ahora.getTime() - masViejosQueMs).toISOString();
  const { count, error } = await supabase.from('conversaciones')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', cfg.id).not('aviso_pendiente_at', 'is', null).lt('aviso_pendiente_at', limite);
  if (error) throw new Error(`Error contando avisos pendientes: ${error.message}`);
  const deMemoria = pendientesEnMemoria(cfg).filter((p) => p.aviso.desde < limite).length;
  return (count ?? 0) + deMemoria;
}
