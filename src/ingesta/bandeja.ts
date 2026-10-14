import { supabase } from '../db/supabase.js';
import { cargarClientesActivos } from '../config/cliente.js';
import type { ClienteConfig, MensajeEntrante, TipoMensaje, TurnoEntrante } from '../types/index.js';
import { asegurarConversacion, guardarMensaje } from '../conversacion/almacen.js';
import { pausarBot } from '../conversacion/estado.js';
import {
  actualizarAvisoPendiente, leerAvisosPendientes, limpiarAvisoPendiente, registrarAvisoPendiente, type EntradaPendiente,
} from '../conversacion/avisoPendiente.js';
import { alertarAlEquipo } from '../salida/alertaEquipo.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';
import { registrarLatido } from '../operacion/salud.js';
import { enviarMensaje, enviarNotaPrivada, marcarAbierta } from '../salida/chatwoot.js';
import { EnvioIncierto } from '../salida/errores.js';
import { avisarAlCelular } from '../salida/avisoEquipo.js';
import { tipoDeAdjuntos, type Aviso } from './aviso.js';
import { conCandado } from './lock.js';
import { registrarEnCurso } from './enCurso.js';
import { atenderYMarcar } from './procesarEntrante.js';

/**
 * BANDEJA DURABLE (PC-13 / ADR-13, opción B).
 *  1. Todo mensaje del huésped se guarda en `mensajes` ANTES de responderle 200 a Chatwoot (guardarEntranteDurable).
 *  2. Queda con `atendido_at` nulo hasta que el bot le responde o el equipo es avisado.
 *  3. Cada minuto, barrerBandeja mira lo que lleva más de ESPERA_MINIMA sin atender:
 *       · ya hay una respuesta posterior (bot o persona)  → se marca atendido, sin tocar nada;
 *       · lleva menos de LIMITE_REINTENTO                 → se rehace el turno bajo el candado de la conversación;
 *       · lleva más (o no hay Redis para el candado)       → nota privada + aviso al equipo, sin pausar ni escribirle al huésped.
 *  4. Avisos al equipo que no se pudieron confirmar (PC-15) se reintentan en cada barrido; al salir, se completa la
 *     pausa y el texto al huésped que estaban esperando. Mientras tanto, el huésped no recibió ningún «ya avisé».
 * Así no existe un camino donde un mensaje se pierda sin que nadie se entere.
 */
export const ESPERA_MINIMA_MS = 3 * 60_000;
export const LIMITE_REINTENTO_MS = 15 * 60_000;
/** Mensajes más viejos que esto se ignoran (historia, no una conversación viva). */
export const VENTANA_MAXIMA_MS = 24 * 3_600_000;
export const INTERVALO_BARRIDO_MS = 60_000;
const MAX_CONVERSACIONES_POR_BARRIDO = 20;

const dato = (x: unknown): string => (typeof x === 'string' ? x : '');

/** ¿Este aviso es un mensaje del huésped que hay que dejar guardado antes del 200? */
export function esEntranteGuardable(a: Aviso): boolean {
  return a.direccion === 'entrante' && !a.privado && a.messageId !== null && a.conversationId !== null
    && (a.contenido !== '' || a.adjuntos.length > 0);
}

/**
 * Guarda el mensaje del huésped (idempotente: unique(cliente_id, chatwoot_message_id)). Se llama antes del 200.
 * `atendido`: nace ya atendido (bot apagado: el equipo lo ve abierto).
 */
export async function guardarEntranteDurable(cfg: ClienteConfig, a: Aviso, atendido = false): Promise<void> {
  if (!esEntranteGuardable(a) || a.conversationId === null) return;
  const fila = await asegurarConversacion(cfg, {
    conversationId: a.conversationId, contactId: a.contactId, telefono: a.telefono, canal: 'whatsapp',
  });
  const tipo: TipoMensaje = a.contenido ? 'texto' : tipoDeAdjuntos(a.adjuntos);
  await guardarMensaje(cfg, {
    conversacionId: fila.id, chatwootMessageId: a.messageId, rol: 'huesped', tipo,
    contenido: enmascararSensibles(a.contenido) || `[${tipo}]`,
    ...(atendido ? { atendidoAt: new Date().toISOString() } : {}),
  });
}

type FilaPendiente = { id: string; conversacion_id: string; chatwoot_message_id: number | null; contenido: string | null; tipo: string; created_at: string };
type FilaConv = { id: string; chatwoot_conversation_id: number; chatwoot_contact_id: number | null; telefono: string | null };

export type ResumenBarrido = {
  revisadas: number; reintentadas: number; escaladas: number; yaContestadas: number; ocupadas: number;
  /** Avisos pendientes (PC-15) que por fin salieron y se completaron / que siguen sin poder salir. */
  avisosCompletados: number; avisosSinConfirmar: number;
};

async function marcarFilas(cfg: ClienteConfig, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('mensajes').update({ atendido_at: new Date().toISOString() })
    .eq('cliente_id', cfg.id).in('id', ids);
  if (error) throw new Error(`Error marcando mensajes como atendidos: ${error.message}`);
}

function armarTurno(cfg: ClienteConfig, conv: FilaConv, filas: FilaPendiente[]): TurnoEntrante {
  const mensajes: MensajeEntrante[] = filas.map((f) => {
    const tipo = (f.tipo || 'texto') as TipoMensaje;
    const crudo = dato(f.contenido);
    // Los adjuntos sin texto se guardan como «[imagen]»: para el router eso es «sin texto».
    const contenido = tipo !== 'texto' && crudo === `[${tipo}]` ? '' : crudo;
    return {
      clienteId: cfg.id, chatwootAccountId: cfg.chatwootAccountId, chatwootConversationId: conv.chatwoot_conversation_id,
      chatwootContactId: conv.chatwoot_contact_id ?? 0, chatwootMessageId: Number(f.chatwoot_message_id) || 0,
      canal: 'whatsapp', telefono: conv.telefono, contenido, tipo, recibidoAt: f.created_at,
    };
  });
  return {
    clienteId: cfg.id, chatwootConversationId: conv.chatwoot_conversation_id, mensajes,
    textoAgrupado: mensajes.map((m) => m.contenido).filter(Boolean).join('\n'),
  };
}

/**
 * Nota privada + aviso al equipo por un mensaje que nadie atendió. No pausa y no le escribe al huésped.
 * Devuelve true si el equipo quedó avisado de forma confirmada; si no, queda un aviso pendiente (que reintenta la
 * fase de avisos del próximo barrido) y los mensajes siguen sin atender.
 */
async function escalarSinAtender(cfg: ClienteConfig, conv: FilaConv, filas: FilaPendiente[], ahora: Date, motivo: string): Promise<boolean> {
  const minutos = Math.round((ahora.getTime() - new Date(filas[0]!.created_at).getTime()) / 60_000);
  const texto = filas.map((f) => dato(f.contenido)).filter(Boolean).join(' / ').slice(0, 300);
  const nota = `⚠️ Mensaje SIN RESPONDER (${motivo}): el huésped escribió hace ${minutos} min y el bot no pudo atenderlo. `
    + `Revisa la conversación y respóndele tú.\nMensaje del huésped: "${texto}"`;
  const alerta = await alertarAlEquipo(cfg, conv.chatwoot_conversation_id, nota, { abrir: true });
  if (alerta.avisado) return true;
  await registrarAvisoPendiente(cfg, conv.chatwoot_conversation_id, {
    nota, motivo: 'mensaje_sin_atender', pausar: false, textoHuesped: null, idioma: cfg.idiomaDefault, notaCreada: alerta.nota,
  });
  return false;
}

async function atenderConversacion(cfg: ClienteConfig, conversacionId: string, filas: FilaPendiente[], ahora: Date, r: ResumenBarrido): Promise<void> {
  const { data: convData, error: convError } = await supabase.from('conversaciones')
    .select('id, chatwoot_conversation_id, chatwoot_contact_id, telefono, aviso_pendiente_at')
    .eq('cliente_id', cfg.id).eq('id', conversacionId).maybeSingle();
  if (convError) throw new Error(`Error leyendo la conversación: ${convError.message}`);
  const conv = convData as (FilaConv & { aviso_pendiente_at?: string | null }) | null;
  if (!conv) return;
  // Con un aviso pendiente, esta conversación la retoma la fase de avisos (completa la escalación y marca lo atendido).
  if (conv.aviso_pendiente_at) return;

  // ¿Ya lo contestó alguien (bot o persona) después? Entonces solo falta marcarlo: NUNCA se rehace un turno contestado.
  const { data: ultima, error: ultimaError } = await supabase.from('mensajes').select('created_at')
    .eq('cliente_id', cfg.id).eq('conversacion_id', conversacionId).in('rol', ['bot', 'agente'])
    .order('created_at', { ascending: false }).limit(1);
  if (ultimaError) throw new Error(`Error leyendo la última respuesta: ${ultimaError.message}`);
  const ultimaRespuesta = dato((ultima as Array<{ created_at: unknown }> | null)?.[0]?.created_at);
  const contestadas = ultimaRespuesta ? filas.filter((f) => f.created_at <= ultimaRespuesta) : [];
  const pendientes = filas.filter((f) => !contestadas.includes(f));
  if (contestadas.length > 0) {
    await marcarFilas(cfg, contestadas.map((f) => f.id));
    r.yaContestadas += contestadas.length;
  }
  if (pendientes.length === 0) return;

  const edadMs = ahora.getTime() - new Date(pendientes[0]!.created_at).getTime();
  const ids = pendientes.map((f) => f.id);
  if (edadMs > LIMITE_REINTENTO_MS) {
    if (await escalarSinAtender(cfg, conv, pendientes, ahora, 'más de 15 min')) {
      await marcarFilas(cfg, ids);
      r.escaladas++;
    }
    return;
  }

  const turno = armarTurno(cfg, conv, pendientes);
  try {
    const ejecutado = await conCandado(`${cfg.id}:${conv.chatwoot_conversation_id}`, async () => {
      await atenderYMarcar(cfg, turno);
      return true;
    });
    if (ejecutado === null) {
      r.ocupadas++; // un turno normal está en curso en esta conversación: se vuelve a mirar en el próximo barrido
      return;
    }
    r.reintentadas++;
  } catch (e) {
    // Sin Redis no hay candado: no se puede rehacer el turno con seguridad. Se avisa al equipo en vez de callar.
    console.error(`BANDEJA: no se pudo reintentar conv=${conv.chatwoot_conversation_id}:`, e instanceof Error ? e.message : e);
    if (await escalarSinAtender(cfg, conv, pendientes, ahora, 'el bot no pudo reintentar')) {
      await marcarFilas(cfg, ids);
      r.escaladas++;
    }
  }
}

async function marcarConversacionAtendida(cfg: ClienteConfig, conversacionId: string): Promise<void> {
  const { error } = await supabase.from('mensajes').update({ atendido_at: new Date().toISOString() })
    .eq('cliente_id', cfg.id).eq('conversacion_id', conversacionId).eq('rol', 'huesped').is('atendido_at', null);
  if (error) throw new Error(`Error marcando la conversación como atendida: ${error.message}`);
}

/** Reintenta UN aviso pendiente. Si sale, completa la escalación que estaba esperando. Nunca lanza. */
async function completarAvisoPendiente(cfg: ClienteConfig, e: EntradaPendiente, r: ResumenBarrido): Promise<void> {
  try {
    let p = e.aviso;
    if (!p.notaCreada) {
      try {
        await enviarNotaPrivada(cfg, e.conversationId, p.nota);
        p = { ...p, notaCreada: true };
        await actualizarAvisoPendiente(cfg, e, { notaCreada: true });
      } catch (err) {
        console.error(`AVISO PENDIENTE: la nota sigue sin poder crearse conv=${e.conversationId}:`, err instanceof Error ? err.message : err);
      }
    }
    const celular = await avisarAlCelular(cfg, e.conversationId, p.nota);
    const avisado = celular === 'enviado' || (celular === 'sin_canal' && p.notaCreada);
    if (!avisado) {
      r.avisosSinConfirmar++;
      return;
    }
    // Fila de la conversación (la pendiente en memoria no la trae) y su estado actual.
    const { data, error } = await supabase.from('conversaciones')
      .select('id, estado_bot, motivo_escalamiento')
      .eq('cliente_id', cfg.id).eq('chatwoot_conversation_id', e.conversationId).maybeSingle();
    if (error) throw new Error(`Error leyendo la conversación: ${error.message}`);
    const fila = data as { id: string; estado_bot: string; motivo_escalamiento: string | null } | null;
    // Si una persona la tomó mientras tanto, no se le pisa ni se le cambia el motivo de la pausa.
    const tomadaPorPersona = fila?.estado_bot === 'pausado' && fila.motivo_escalamiento === 'agente_respondio';
    if (p.pausar && !tomadaPorPersona) {
      await pausarBot(cfg, e.conversationId, p.motivo);
      await actualizarAvisoPendiente(cfg, e, { pausar: false });
      p = { ...p, pausar: false };
    }
    if (p.textoHuesped && !tomadaPorPersona) {
      try {
        const id = await enviarMensaje(cfg, e.conversationId, p.textoHuesped);
        if (fila) {
          await guardarMensaje(cfg, {
            conversacionId: fila.id, chatwootMessageId: id, rol: 'bot', contenido: p.textoHuesped, origen: 'escalamiento',
          }).catch((err) => console.error('AVISO PENDIENTE: no se guardó el mensaje al huésped:', err instanceof Error ? err.message : err));
        }
      } catch (err) {
        if (!(err instanceof EnvioIncierto)) throw err; // salió mal pero seguro: se reintenta en el próximo barrido
        console.error(`AVISO PENDIENTE: no se pudo confirmar el envío al huésped conv=${e.conversationId}; no se repite`);
        await enviarNotaPrivada(cfg, e.conversationId, '⚠️ No se pudo confirmar si el aviso llegó al huésped: revisa la conversación antes de escribirle.')
          .catch(() => undefined);
      }
    }
    await limpiarAvisoPendiente(cfg, e.conversationId);
    if (fila) await marcarConversacionAtendida(cfg, fila.id);
    r.avisosCompletados++;
    console.log(`AVISO PENDIENTE completado conv=${e.conversationId} motivo=${p.motivo}`);
  } catch (err) {
    r.avisosSinConfirmar++;
    console.error(`AVISO PENDIENTE: no se pudo completar conv=${e.conversationId}; sigue pendiente:`, err instanceof Error ? err.message : err);
  }
}

/** Un barrido: recorre los clientes activos y atiende lo que quedó sin atender. */
export async function barrerBandeja(ahora: Date = new Date()): Promise<ResumenBarrido> {
  registrarLatido('bandeja', ahora.getTime());
  const r: ResumenBarrido = {
    revisadas: 0, reintentadas: 0, escaladas: 0, yaContestadas: 0, ocupadas: 0, avisosCompletados: 0, avisosSinConfirmar: 0,
  };
  const hasta = new Date(ahora.getTime() - ESPERA_MINIMA_MS).toISOString();
  const desde = new Date(ahora.getTime() - VENTANA_MAXIMA_MS).toISOString();
  let revisadasEnElBarrido = 0;
  const clientes = await cargarClientesActivos();
  // 1) Avisos al equipo pendientes (también con el bot apagado: es avisar al equipo, no hablarle al huésped).
  for (const cfg of clientes) {
    const pendientes = await leerAvisosPendientes(cfg).catch((e) => {
      console.error(`BANDEJA: no se pudieron leer los avisos pendientes de ${cfg.slug}:`, e instanceof Error ? e.message : e);
      return [] as EntradaPendiente[];
    });
    for (const p of pendientes) await completarAvisoPendiente(cfg, p, r);
  }
  // 2) Mensajes sin atender.
  for (const cfg of clientes) {
    if (!cfg.botActivo) continue; // con el bot apagado el equipo atiende desde Chatwoot: no se le contesta al huésped
    const { data, error } = await supabase.from('mensajes')
      .select('id, conversacion_id, chatwoot_message_id, contenido, tipo, created_at')
      .eq('cliente_id', cfg.id).eq('rol', 'huesped').is('atendido_at', null)
      .lt('created_at', hasta).gte('created_at', desde)
      .order('created_at', { ascending: true }).limit(200);
    if (error) throw new Error(`Error leyendo la bandeja: ${error.message}`);
    const porConversacion = new Map<string, FilaPendiente[]>();
    for (const f of (data ?? []) as FilaPendiente[]) {
      porConversacion.set(f.conversacion_id, [...(porConversacion.get(f.conversacion_id) ?? []), f]);
    }
    for (const [conversacionId, filas] of porConversacion) {
      if (revisadasEnElBarrido >= MAX_CONVERSACIONES_POR_BARRIDO) return r;
      revisadasEnElBarrido++;
      r.revisadas++;
      // Un fallo en una conversación no frena a las demás.
      await atenderConversacion(cfg, conversacionId, filas, ahora, r).catch((e) => {
        console.error(`BANDEJA: falló la conversación ${conversacionId}:`, e instanceof Error ? e.message : e);
      });
    }
  }
  return r;
}

/** Arranca el barrido periódico. Devuelve la función que lo detiene. */
export function iniciarBarrido(intervaloMs: number = INTERVALO_BARRIDO_MS): () => void {
  let corriendo = false;
  const reloj = setInterval(() => {
    if (corriendo) return; // no se solapan dos barridos
    corriendo = true;
    registrarEnCurso(
      barrerBandeja()
        .then((r) => {
          if (r.revisadas > 0) console.log(`BANDEJA barrido ${JSON.stringify(r)}`);
        })
        .catch((e) => console.error('BANDEJA: el barrido falló:', e instanceof Error ? e.message : e))
        .finally(() => { corriendo = false; }),
    );
  }, intervaloMs);
  reloj.unref();
  registrarLatido('bandeja');
  return () => clearInterval(reloj);
}
