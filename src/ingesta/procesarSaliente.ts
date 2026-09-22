import type { ClienteConfig } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { avisarFallo } from './atenderTurno.js';
import { guardarMensaje, obtenerContexto } from '../conversacion/almacen.js';
import { pausarBot } from '../conversacion/estado.js';
import { idUsuarioBot } from '../salida/chatwoot.js';

/** Mensaje que SALE en Chatwoot: si lo escribió una persona del equipo, el bot se pausa. */
export async function procesarSaliente(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || a.privado) return; // las notas privadas nunca pausan
  const botId = await idUsuarioBot(cfg);
  if (a.remitenteId === null || botId === null) {
    console.warn(`SALIENTE SIN REMITENTE CLARO conv=${conversationId}: no se pausa`);
    return;
  }
  // Solo cuenta como persona un usuario de Chatwoot que no sea el propio bot.
  if (a.remitenteTipo !== 'user' || a.remitenteId === botId) return;
  if (a.messageId !== null && (await yaProcesado(cfg.id, a.messageId))) return;
  const conv = await obtenerContexto(cfg, {
    conversationId, contactId: a.contactId, telefono: a.telefono, canal: 'whatsapp',
  });
  if (a.contenido) {
    await guardarMensaje(cfg, {
      conversacionId: conv.id, chatwootMessageId: a.messageId, rol: 'agente',
      contenido: a.contenido, origen: 'agente',
    }).catch(avisarFallo('NO SE GUARDÓ el mensaje del agente'));
  }
  await pausarBot(cfg, conversationId, 'agente_respondio');
  console.log(`BOT PAUSADO conv=${conversationId}: respondió una persona (usuario ${a.remitenteId})`);
}
