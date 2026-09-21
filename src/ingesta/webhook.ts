import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { cargarClientePorChatwootAccount } from '../config/cliente.js';
import { enviarMensaje } from '../salida/chatwoot.js';
import type { ContextoConversacion } from '../types/index.js';
import { llamarLLM } from '../llm/llamarLLM.js';
import { construirSystemPrompt } from '../llm/prompt.js';
import { herramientas } from '../llm/herramientas/index.js';
import { responderYEscalar } from '../salida/escalamiento.js';

/**
 * POST /webhook/chatwoot
 * Contrato: responde 200 en < 200 ms SIEMPRE (Chatwoot reintenta si no). El procesamiento es asíncrono.
 * Pasos (ver §11.4 en Notion): validar secreto → filtrar solo message_created de contacto (no de agente)
 * → mapear a MensajeEntrante → dedup → buffer → procesar bajo candado.
 *
 * VERSIÓN TEMPORAL: la configuración del cliente ya viene de Supabase, pero la respuesta sigue siendo
 * una frase fija. Sin IA todavía.
 * TEMPORAL: el secreto llega en la URL (?secret=...) porque Chatwoot no permite encabezados propios.
 * Pendiente: cambiar a la firma oficial de Chatwoot (X-Chatwoot-Signature).
 */

type CuerpoChatwoot = {
  event?: string;
  message_type?: string;
  content?: string;
  conversation?: { id?: number };
  account?: { id?: number };
};

/** Compara dos textos sin filtrar información por el tiempo que tarda la comparación. */
function secretosIguales(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

function leerSecreto(encabezado: string | string[] | undefined, query: unknown): string | undefined {
  const deEncabezado = Array.isArray(encabezado) ? encabezado[0] : encabezado;
  if (deEncabezado) return deEncabezado;
  const deUrl = (query as { secret?: unknown } | null)?.secret;
  return typeof deUrl === 'string' ? deUrl : undefined;
}

/** Saludo simple sin pregunta. Ahí no se obliga a consultar herramientas. */
function esSoloSaludo(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(hola|holi|holis|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hello|hi|hey|good morning|good afternoon|good evening|saludos)$/.test(t);
}

export async function registrarWebhookChatwoot(app: FastifyInstance): Promise<void> {
  app.post('/webhook/chatwoot', async (req, reply) => {
    const recibido = leerSecreto(req.headers['x-jutilabs-secret'], req.query);
    if (!secretosIguales(recibido, env.CHATWOOT_WEBHOOK_SECRET)) {
      return reply.code(401).send({ ok: false });
    }

    const cuerpo = (req.body ?? {}) as CuerpoChatwoot;
    const conversationId = cuerpo.conversation?.id;
    const accountId = cuerpo.account?.id;

    // Solo mensajes que ENTRAN del cliente. Si no, el bot se respondería a sí mismo sin parar.
    if (
      cuerpo.event === 'message_created' &&
      cuerpo.message_type === 'incoming' &&
      conversationId &&
      accountId
    ) {
      void (async () => {
        const cfg = await cargarClientePorChatwootAccount(accountId);
        // Kill-switch: cliente desconocido, inactivo o con el bot apagado → se ignora.
        if (!cfg || !cfg.activo || !cfg.botActivo) return;
        const texto = (cuerpo.content ?? '').trim();
        if (!texto) return; // sin texto (foto, audio...): el router de media llegará después
        // TEMPORAL: sin router/dedup/buffer/lock todavía; el contexto se arma mínimo.
        const conv: ContextoConversacion = {
          id: '', clienteId: cfg.id, chatwootConversationId: conversationId, canal: 'whatsapp',
          idioma: cfg.idiomaDefault, pais: null, estadoBot: 'activo', formularioActivo: null,
          mensajesSalientesHoy: 0, ultimosMensajes: [],
        };
        const resp = await llamarLLM(
          [{ rol: 'system', contenido: construirSystemPrompt(cfg, conv) }, { rol: 'user', contenido: texto }],
          herramientas,
          { cfg, conv },
          { forzarHerramienta: !esSoloSaludo(texto) },
        );
        console.log(`LLM ${resp.modelo} ${resp.latenciaMs}ms tokens ${resp.tokensEntrada}/${resp.tokensSalida} herramientas=[${resp.herramientasUsadas.join(',')}] noSe=${resp.noSeElDato}`);
        if (resp.noSeElDato) {
          // Nunca se envía el texto del modelo aquí: en la prueba marcó "no sé" e igual inventó.
          await responderYEscalar(cfg, conversationId, conv.idioma, texto);
          return;
        }
        if (resp.texto) await enviarMensaje(cfg, conversationId, resp.texto);
      })().catch((e) => {
        console.error('Falló el procesamiento del mensaje:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
      });
    }

    return reply.code(200).send({ ok: true });
  });
}
