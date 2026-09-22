import type { ClienteConfig, MensajeEntrante } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { agregarAlBuffer } from './buffer.js';
import { conCandadoEsperando } from './esperaCandado.js';
import { atenderTurno, manejarFalloDeTurno } from './atenderTurno.js';

/** Mensaje que ENTRA del huésped: duplicados → buffer → candado (con espera) → turno. */
export async function procesarEntrante(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || a.privado) return;
  if (!a.contenido) {
    console.log(`IGNORADO conv=${conversationId} motivo=sin_texto (fotos y audios: falta la regla de media)`);
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
    canal: 'whatsapp', telefono: a.telefono, contenido: a.contenido, tipo: 'texto',
    recibidoAt: new Date().toISOString(),
  };
  const turno = await agregarAlBuffer(msg);
  if (!turno) return;
  const r = await conCandadoEsperando(`${cfg.id}:${conversationId}`, async () => {
    try {
      await atenderTurno(cfg, turno);
    } catch (e) {
      console.error('FALLÓ EL TURNO:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
      await manejarFalloDeTurno(cfg, turno);
    }
  });
  if (!r.ok) console.error(`TURNO PERDIDO conv=${conversationId}: siguió ocupada 90 s`);
}
