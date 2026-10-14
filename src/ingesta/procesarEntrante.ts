import type { ClienteConfig, MensajeEntrante, TurnoEntrante } from '../types/index.js';
import { marcarAtendidos } from '../conversacion/almacen.js';
import { tipoDeAdjuntos, type Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { agregarAlBuffer } from './buffer.js';
import { conCandadoEsperando } from './esperaCandado.js';
import { atenderTurno, manejarFalloDeTurno } from './atenderTurno.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';

/**
 * Corre un turno y, si termina atendido, marca sus mensajes (`atendido_at`). Si el turno revienta se recupera con
 * manejarFalloDeTurno; si ni eso se puede, el error SE PROPAGA y los mensajes quedan sin atender (los retoma el barrido).
 * Si marcar falla NO se lanza: el turno ya contestó y repetirlo duplicaría la respuesta (el barrido lo detecta:
 * ve que ya hay una respuesta posterior).
 */
export async function atenderYMarcar(cfg: ClienteConfig, turno: TurnoEntrante): Promise<void> {
  let resultado: { atendido: boolean };
  try {
    resultado = await atenderTurno(cfg, turno);
  } catch (e) {
    console.error('FALLÓ EL TURNO:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    resultado = await manejarFalloDeTurno(cfg, turno, e);
  }
  if (!resultado.atendido) return;
  const ids = turno.mensajes.map((m) => m.chatwootMessageId);
  await marcarAtendidos(cfg, ids).catch((e) => {
    console.error(`NO SE PUDO MARCAR COMO ATENDIDO conv=${turno.chatwootConversationId}:`, e instanceof Error ? e.message : e);
  });
}

/** Mensaje que ENTRA del huésped: duplicados → buffer → candado (con espera) → turno. */
export async function procesarEntrante(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || a.privado) return;
  if (!a.contenido && a.adjuntos.length === 0) {
    console.log(`IGNORADO conv=${conversationId} motivo=sin_texto_ni_adjuntos`);
    return;
  }
  if (a.messageId === null) console.warn(`AVISO SIN ID DE MENSAJE conv=${conversationId}: no se detectan duplicados`);
  else if (await yaProcesado(cfg.id, a.messageId)) {
    console.log(`DUPLICADO conv=${conversationId} mensaje=${a.messageId}`);
    return;
  }
  const msg: MensajeEntrante = {
    clienteId: cfg.id, chatwootAccountId: cfg.chatwootAccountId, chatwootConversationId: conversationId,
    chatwootContactId: a.contactId ?? 0, chatwootMessageId: a.messageId ?? 0,
    canal: 'whatsapp', telefono: a.telefono,
    // Tarjetas y claves se ocultan aquí, antes del buffer: la base, la nota, Telegram y el modelo ya reciben el texto limpio.
    contenido: enmascararSensibles(a.contenido), tipo: a.contenido ? 'texto' : tipoDeAdjuntos(a.adjuntos),
    recibidoAt: new Date().toISOString(),
  };
  const turno = await agregarAlBuffer(msg);
  if (!turno) return;
  const r = await conCandadoEsperando(`${cfg.id}:${conversationId}`, () => atenderYMarcar(cfg, turno));
  if (!r.ok) console.error(`TURNO PERDIDO conv=${conversationId}: siguió ocupada más allá del vencimiento del candado`);
}
