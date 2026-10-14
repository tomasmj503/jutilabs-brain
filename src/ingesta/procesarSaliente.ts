import type { ClienteConfig } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { avisarFallo } from './atenderTurno.js';
import { guardarMensaje, obtenerContexto } from '../conversacion/almacen.js';
import { pausarBot } from '../conversacion/estado.js';
import { registrarAvisoPendiente } from '../conversacion/avisoPendiente.js';
import { idUsuarioBot } from '../salida/chatwoot.js';
import { alertarAlEquipo, conUnReintento } from '../salida/alertaEquipo.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';

/**
 * Mensaje que SALE en Chatwoot: si lo escribió una persona del equipo, el bot se pausa.
 * PC-10: si no se puede saber quién lo escribió, o la pausa falla, NO se calla: se avisa al equipo (un bot que sigue
 * hablando encima de una persona sin que nadie lo sepa es el peor caso).
 */
export async function procesarSaliente(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || a.privado) return; // las notas privadas nunca pausan
  let botId: number | null;
  try {
    botId = await idUsuarioBot(cfg);
  } catch (e) {
    console.error(`SALIENTE: no se pudo saber quién es el usuario del bot conv=${conversationId}:`, e instanceof Error ? e.message : e);
    await alertarAlEquipo(cfg, conversationId,
      '🚨 No se pudo saber si el último mensaje de esta conversación lo escribió una persona (falla al consultar a Chatwoot), '
      + 'así que el bot NO se pausó y puede contestarle al huésped encima. Revisa la conversación.');
    return;
  }
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
      contenido: enmascararSensibles(a.contenido), origen: 'agente',
    }).catch(avisarFallo('NO SE GUARDÓ el mensaje del agente'));
  }
  const pausado = await conUnReintento('pausar (respondió una persona)', conversationId, () => pausarBot(cfg, conversationId, 'agente_respondio'));
  if (!pausado) {
    const nota = '🚨 NO SE PUDO PAUSAR el bot aunque una persona escribió en esta conversación (falla técnica). '
      + 'El bot puede contestarle al huésped encima: revisa la conversación y avisa al equipo técnico.';
    const alerta = await alertarAlEquipo(cfg, conversationId, nota);
    if (!alerta.avisado) {
      await registrarAvisoPendiente(cfg, conversationId, {
        nota, motivo: 'agente_respondio', pausar: true, textoHuesped: null, idioma: conv.idioma, notaCreada: alerta.nota,
      });
    }
    return;
  }
  console.log(`BOT PAUSADO conv=${conversationId}: respondió una persona (usuario ${a.remitenteId})`);
}
