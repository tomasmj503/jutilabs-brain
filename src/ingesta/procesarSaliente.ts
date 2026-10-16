import type { ClienteConfig } from '../types/index.js';
import type { Aviso } from './aviso.js';
import { yaProcesado } from './dedup.js';
import { avisarFallo } from './atenderTurno.js';
import { guardarMensaje, obtenerContexto } from '../conversacion/almacen.js';
import { pausarBot } from '../conversacion/estado.js';
import { registrarAvisoPendiente } from '../conversacion/avisoPendiente.js';
import { modoAgentBot } from '../config/agentBot.js';
import { cambiarEstado, idUsuarioBot } from '../salida/chatwoot.js';
import { alertarAlEquipo, conUnReintento } from '../salida/alertaEquipo.js';
import { enmascararSensibles } from '../seguridad/enmascarar.js';

/**
 * Mensaje que SALE en Chatwoot: si lo escribió una persona del equipo, el bot se pausa.
 *  - Modo Agent Bot (chatwootBotTokenRef): lo del bot es sender.type "agent_bot" y se ignora; si escribió una persona
 *    ("user"), además de pausar la conversación pasa a "open".
 *  - Modo anterior: el bot es un usuario más, se distingue por su id (/api/v1/profile); no se cambia el estado.
 * PC-10: si no se puede saber quién lo escribió, o la pausa falla, NO se calla: se avisa al equipo (un bot que sigue
 * hablando encima de una persona sin que nadie lo sepa es el peor caso).
 */
export async function procesarSaliente(cfg: ClienteConfig, a: Aviso): Promise<void> {
  const conversationId = a.conversationId;
  if (conversationId === null || a.privado) return; // las notas privadas nunca pausan
  const modoBot = modoAgentBot(cfg);
  if (modoBot && a.remitenteTipo === 'agent_bot') return; // lo escribió el propio bot
  let botId: number | null = null;
  if (!modoBot) {
    try {
      botId = await idUsuarioBot(cfg);
    } catch (e) {
      console.error(`SALIENTE: no se pudo saber quién es el usuario del bot conv=${conversationId}:`, e instanceof Error ? e.message : e);
      await alertarAlEquipo(cfg, conversationId,
        '🚨 No se pudo saber si el último mensaje de esta conversación lo escribió una persona (falla al consultar a Chatwoot), '
        + 'así que el bot NO se pausó y puede contestarle al huésped encima. Revisa la conversación.');
      return;
    }
  }
  if (a.remitenteId === null || (!modoBot && botId === null)) {
    console.warn(`SALIENTE SIN REMITENTE CLARO conv=${conversationId}: no se pausa`);
    return;
  }
  // Solo cuenta como persona un usuario de Chatwoot (y, en el modo anterior, que no sea el propio bot).
  if (a.remitenteTipo !== 'user' || (!modoBot && a.remitenteId === botId)) return;
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
  let abierta = false;
  if (modoBot) {
    // En Chatwoot community una respuesta humana NO pasa sola la conversación de "pending" a "open", y el bot solo atiende
    // en "pending": abrirla es lo que la saca de su alcance (también si la pausa falló: es una segunda barrera).
    abierta = await conUnReintento('abrir (respondió una persona)', conversationId, () => cambiarEstado(cfg, conversationId, 'open'));
    if (!abierta) console.error(`SALIENTE: no se pudo pasar a "open" conv=${conversationId} tras responder una persona (el bot ${pausado ? 'queda pausado' : 'NO quedó pausado'})`);
  }
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
  console.log(`BOT PAUSADO conv=${conversationId}: respondió una persona (usuario ${a.remitenteId})${abierta ? ', conversación abierta' : ''}`);
}
