import type { ClienteConfig } from '../types/index.js';
import { env, secretoPorRef } from '../config/env.js';

async function llamarChatwoot(
  cfg: ClienteConfig,
  conversationId: number,
  ruta: string,
  cuerpo: Record<string, unknown>,
): Promise<Response> {
  const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/${ruta}`;

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      // Con guion, no guion bajo: Caddy descarta los encabezados con guion bajo.
      'api-access-token': secretoPorRef(cfg.chatwootTokenRef),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Chatwoot respondió ${respuesta.status} en ${ruta}: ${detalle.slice(0, 200)}`);
  }
  return respuesta;
}

/** Envía un mensaje al cliente. Devuelve el id del mensaje creado en Chatwoot. */
export async function enviarMensaje(cfg: ClienteConfig, conversationId: number, texto: string): Promise<number> {
  const respuesta = await llamarChatwoot(cfg, conversationId, 'messages', {
    content: texto,
    message_type: 'outgoing',
    private: false,
  });
  const datos = (await respuesta.json()) as { id?: number };
  if (typeof datos.id !== 'number') {
    throw new Error('Chatwoot no devolvió el id del mensaje');
  }
  return datos.id;
}

/** Deja la conversación en estado "pendiente" (esperando a una persona). */
export async function marcarPendiente(cfg: ClienteConfig, conversationId: number): Promise<void> {
  await llamarChatwoot(cfg, conversationId, 'toggle_status', { status: 'pending' });
}