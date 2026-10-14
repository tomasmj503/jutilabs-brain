import { supabase } from '../db/supabase.js';
import type { Canal, ClienteConfig, ContextoConversacion, RolMensaje, TipoMensaje } from '../types/index.js';

/** Cuántos mensajes anteriores se le muestran al modelo (la memoria de la conversación). */
export const VENTANA_MENSAJES = 10;

const COLUMNAS = 'id, cliente_id, chatwoot_conversation_id, canal, idioma, pais, estado_bot';
const ROLES: string[] = ['huesped', 'bot', 'agente', 'sistema'];

export type FilaConversacion = {
  id: string;
  cliente_id: string;
  chatwoot_conversation_id: number;
  canal: string;
  idioma: string;
  pais: string | null;
  estado_bot: string;
};

export type FilaMensaje = { rol: string; contenido: string | null; chatwoot_message_id?: number | null };

export type DatosConversacion = {
  conversationId: number;
  contactId: number | null;
  telefono: string | null;
  canal: Canal;
};

export type MensajeAGuardar = {
  conversacionId: string;
  chatwootMessageId: number | null;
  rol: RolMensaje;
  contenido: string;
  tipo?: TipoMensaje | undefined;
  origen?: string | undefined;
  modelo?: string | undefined;
  tokensEntrada?: number | undefined;
  tokensSalida?: number | undefined;
  latenciaMs?: number | undefined;
  herramientas?: string[] | undefined;
  /** Solo para mensajes del huésped que ya nacen atendidos (ej. bot apagado: el equipo lo ve abierto). */
  atendidoAt?: string | undefined;
};

function esRol(x: string): x is RolMensaje {
  return ROLES.includes(x);
}

/** Arma el contexto que usa el router y el modelo. Sin base de datos: solo transforma filas. */
export function armarContexto(fila: FilaConversacion, filasMensajes: FilaMensaje[]): ContextoConversacion {
  const ultimosMensajes: ContextoConversacion['ultimosMensajes'] = [];
  for (const m of filasMensajes) {
    const contenido = m.contenido?.trim();
    if (!contenido || !esRol(m.rol)) continue;
    ultimosMensajes.push({ rol: m.rol, contenido });
  }
  return {
    id: fila.id,
    clienteId: fila.cliente_id,
    chatwootConversationId: fila.chatwoot_conversation_id,
    canal: fila.canal === 'web' ? 'web' : 'whatsapp',
    idioma: fila.idioma === 'en' ? 'en' : 'es',
    pais: fila.pais,
    estadoBot: fila.estado_bot === 'pausado' ? 'pausado' : 'activo',
    formularioActivo: null, // los formularios se conectan más adelante
    mensajesSalientesHoy: 0, // el límite diario se conecta más adelante
    ultimosMensajes,
  };
}

async function leerConversacion(cfg: ClienteConfig, conversationId: number): Promise<FilaConversacion | null> {
  const { data, error } = await supabase
    .from('conversaciones')
    .select(COLUMNAS)
    .eq('cliente_id', cfg.id)
    .eq('chatwoot_conversation_id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`Error leyendo la conversación: ${error.message}`);
  return data as unknown as FilaConversacion | null;
}

/** Trae (o crea) la fila de la conversación. Idempotente: dos llamadas a la vez dejan una sola fila. */
export async function asegurarConversacion(cfg: ClienteConfig, datos: DatosConversacion): Promise<FilaConversacion> {
  return buscarOCrear(cfg, datos);
}

async function buscarOCrear(cfg: ClienteConfig, datos: DatosConversacion): Promise<FilaConversacion> {
  const existente = await leerConversacion(cfg, datos.conversationId);
  if (existente) return existente;

  const { error } = await supabase.from('conversaciones').insert({
    cliente_id: cfg.id,
    chatwoot_conversation_id: datos.conversationId,
    chatwoot_contact_id: datos.contactId,
    canal: datos.canal,
    telefono: datos.telefono,
    idioma: cfg.idiomaDefault,
  });
  // 23505 = otro turno la creó justo antes: no es un error, solo se lee de nuevo.
  if (error && error.code !== '23505') throw new Error(`Error creando la conversación: ${error.message}`);

  const creada = await leerConversacion(cfg, datos.conversationId);
  if (!creada) throw new Error('La conversación no apareció después de crearla');
  return creada;
}

/**
 * Trae (o crea) la conversación y sus últimos mensajes. Llamar ANTES de guardar el mensaje nuevo.
 * `excluirMensajeIds`: ids de Chatwoot de los mensajes del turno en curso. Como ahora se guardan antes del 200
 * (bandeja durable), ya están en la base y no deben aparecer también en el historial que ve el modelo.
 */
export async function obtenerContexto(
  cfg: ClienteConfig, datos: DatosConversacion, excluirMensajeIds: readonly number[] = [],
): Promise<ContextoConversacion> {
  const fila = await buscarOCrear(cfg, datos);
  const { data, error } = await supabase
    .from('mensajes')
    .select('rol, contenido, chatwoot_message_id')
    .eq('cliente_id', cfg.id)
    .eq('conversacion_id', fila.id)
    .order('created_at', { ascending: false })
    // Se piden de más los que luego se descartan, para seguir devolviendo VENTANA_MENSAJES.
    .limit(VENTANA_MENSAJES + excluirMensajeIds.length);
  if (error) throw new Error(`Error leyendo los mensajes: ${error.message}`);
  const excluir = new Set(excluirMensajeIds);
  const recientes = ((data ?? []) as unknown as FilaMensaje[])
    .filter((m) => m.chatwoot_message_id === null || m.chatwoot_message_id === undefined || !excluir.has(Number(m.chatwoot_message_id)))
    .slice(0, VENTANA_MENSAJES)
    .reverse();
  return armarContexto(fila, recientes);
}

/** Guarda un mensaje. Si ya estaba guardado (mismo id de Chatwoot) no hace nada. */
export async function guardarMensaje(cfg: ClienteConfig, m: MensajeAGuardar): Promise<void> {
  const { error } = await supabase.from('mensajes').insert({
    cliente_id: cfg.id,
    conversacion_id: m.conversacionId,
    chatwoot_message_id: m.chatwootMessageId,
    rol: m.rol,
    tipo: m.tipo ?? 'texto',
    contenido: m.contenido,
    origen: m.origen ?? null,
    modelo: m.modelo ?? null,
    tokens_entrada: m.tokensEntrada ?? null,
    tokens_salida: m.tokensSalida ?? null,
    latencia_ms: m.latenciaMs ?? null,
    herramientas_usadas: m.herramientas ?? null,
    // Solo se envía si viene: así guardar un mensaje normal no depende de que la columna exista.
    ...(m.atendidoAt ? { atendido_at: m.atendidoAt } : {}),
  });
  if (error && error.code !== '23505') throw new Error(`Error guardando el mensaje: ${error.message}`);
}

/**
 * Marca como atendidos los mensajes del huésped de un turno (el bot respondió, o el equipo fue avisado y lo confirmó).
 * Un fallo aquí se lanza: quien llama decide, pero NUNCA debe provocar que se conteste dos veces (ver bandeja.ts).
 */
export async function marcarAtendidos(cfg: ClienteConfig, chatwootMessageIds: readonly number[]): Promise<void> {
  const ids = chatwootMessageIds.filter((id) => id > 0);
  if (ids.length === 0) return;
  const { error } = await supabase.from('mensajes')
    .update({ atendido_at: new Date().toISOString() })
    .eq('cliente_id', cfg.id).eq('rol', 'huesped').in('chatwoot_message_id', ids).is('atendido_at', null);
  if (error) throw new Error(`Error marcando mensajes como atendidos: ${error.message}`);
}
