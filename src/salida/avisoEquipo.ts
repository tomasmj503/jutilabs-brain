import type { ClienteConfig } from '../types/index.js';
import { crearFetch } from '../red/reintento.js';

/**
 * Aviso al celular del equipo (grupo de Telegram del cliente). El cerebro se lo manda a n8n (ADR, Decisión 1) y n8n lo
 * reenvía a Telegram (flujo "JUTILABS - Aviso al equipo", webhook aviso-equipo).
 * NUNCA lanza ni frena el escalamiento, pero SÍ dice si salió (PC-15): el flujo de n8n responde 2xx recién cuando
 * Telegram aceptó el mensaje (responseMode=lastNode, S-07 verificado), así que un 2xx es una confirmación real.
 *   'enviado'   n8n respondió 2xx.
 *   'fallido'   hay grupo configurado y el aviso NO salió (HTTP != 2xx o red).
 *   'sin_canal' el cliente no tiene grupo de avisos: no hay a dónde mandarlo (queda solo la nota de Chatwoot).
 * Política 'segura': repetirlo como mucho duplica un aviso al equipo, nunca un mensaje al huésped.
 */
export type ResultadoAviso = 'enviado' | 'fallido' | 'sin_canal';
const fetchAviso = crearFetch({ nombre: 'aviso-equipo', politica: 'segura', timeoutMs: 8_000, intentos: 2 });

/** Telegram acepta hasta 4.096 caracteres por mensaje. Se deja margen para el encabezado y el enlace. */
const MAX_NOTA = 3_500;

/** Grupo de Telegram del cliente (Supabase: clientes.config_extra → "telegramChatId"). null si no tiene o no es válido. */
export function grupoDeAvisos(cfg: Pick<ClienteConfig, 'configExtra'>): string | null {
  const v = (cfg.configExtra ?? {}).telegramChatId;
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return v.trim();
  return null;
}

/** Texto que llega al grupo: nombre del cliente, la misma nota que queda en Chatwoot y el enlace a la conversación. */
export function textoDelAviso(nombreCliente: string, nota: string, enlace: string): string {
  const cuerpo = nota.length > MAX_NOTA ? `${nota.slice(0, MAX_NOTA)}…` : nota;
  return `🔔 ${nombreCliente}\n${cuerpo}\n\nAbrir en Chatwoot: ${enlace}`;
}

export async function avisarAlCelular(cfg: ClienteConfig, conversationId: number, nota: string): Promise<ResultadoAviso> {
  const chatId = grupoDeAvisos(cfg);
  if (!chatId) return 'sin_canal'; // cliente sin grupo de avisos: queda solo la nota de Chatwoot
  try {
    // Se carga aquí y no arriba: los clientes sin grupo (y las pruebas que no lo usan) no dependen de estas variables.
    const { env } = await import('../config/env.js');
    const base = env.CHATWOOT_BASE_URL.replace(/\/+$/, '');
    const enlace = `${base}/app/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}`;
    const r = await fetchAviso(env.N8N_WEBHOOK_AVISOS, {
      method: 'POST',
      headers: {
        // Con guiones, no guion bajo: Caddy descarta los encabezados con guion bajo.
        'x-jutilabs-secreto': env.N8N_WEBHOOK_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId,
        texto: textoDelAviso(cfg.nombre || cfg.slug || 'Cliente', nota, enlace),
        cliente: cfg.slug,
        conversacion: conversationId,
      }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      console.error(`AVISO AL CELULAR FALLÓ conv=${conversationId} HTTP ${r.status}: ${detalle.slice(0, 200)}`);
      return 'fallido';
    }
    await r.body?.cancel().catch(() => undefined);
    console.log(`AVISO AL CELULAR enviado conv=${conversationId}`);
    return 'enviado';
  } catch (e) {
    console.error(`AVISO AL CELULAR FALLÓ conv=${conversationId}:`, e instanceof Error ? e.message : e);
    return 'fallido';
  }
}
