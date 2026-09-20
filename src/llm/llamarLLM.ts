import OpenAI from 'openai';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM, RespuestaLLM } from '../types/index.js';
import { env, secretoPorRef } from '../config/env.js';

const MARCA_NO_SE = '[[NO_SE]]';
const MAX_RONDAS_HERRAMIENTAS = 3;
const TIMEOUT_MS = 25000;

type Mensaje = { rol: 'system' | 'user' | 'assistant'; contenido: string };
type MensajeAPI = OpenAI.Chat.ChatCompletionMessageParam;
type Ctx = { cfg: ClienteConfig; conv: ContextoConversacion };

function esErrorReintentable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === undefined) return true;
  return status >= 500 || status === 429;
}

async function conversar(
  modelo: string,
  mensajes: Mensaje[],
  herramientas: HerramientaLLM[],
  ctx: Ctx,
): Promise<RespuestaLLM> {
  const cliente = new OpenAI({
    apiKey: secretoPorRef(ctx.cfg.openrouterKeyRef),
    baseURL: env.OPENROUTER_BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  const inicio = Date.now();
  const msgs: MensajeAPI[] = mensajes.map((m) => ({ role: m.rol, content: m.contenido }));
  const tools = herramientas.map((h) => ({
    type: 'function' as const,
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }));
  const usadas: string[] = [];
  let tokensEntrada = 0;
  let tokensSalida = 0;

  for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
    const puedeUsarHerramientas = tools.length > 0 && ronda < MAX_RONDAS_HERRAMIENTAS;

    const r = await cliente.chat.completions.create({
      model: modelo,
      messages: msgs,
      temperature: ctx.cfg.llmTemperatura,
      max_tokens: 500,
      ...(puedeUsarHerramientas ? { tools } : {}),
    });

    tokensEntrada += r.usage?.prompt_tokens ?? 0;
    tokensSalida += r.usage?.completion_tokens ?? 0;

    const msg = r.choices[0]?.message;
    if (!msg) throw new Error('Respuesta vacía del modelo');

    const llamadas = msg.tool_calls ?? [];

    if (llamadas.length === 0 || !puedeUsarHerramientas) {
      const bruto = msg.content ?? '';
      const noSeElDato = bruto.includes(MARCA_NO_SE);
      const texto = bruto.split(MARCA_NO_SE).join('').trim();
      if (!texto && !noSeElDato) throw new Error('El modelo devolvió texto vacío');
      return {
        texto,
        modelo,
        tokensEntrada,
        tokensSalida,
        latenciaMs: Date.now() - inicio,
        herramientasUsadas: usadas,
        noSeElDato,
      };
    }

    msgs.push({ role: 'assistant', content: msg.content ?? null, tool_calls: llamadas });

    for (const llamada of llamadas) {
      const nombre = llamada.function.name;
      const herramienta = herramientas.find((h) => h.nombre === nombre);
      let resultado: unknown;
      try {
        if (!herramienta) throw new Error('Herramienta desconocida');
        const args = JSON.parse(llamada.function.arguments || '{}') as Record<string, unknown>;
        resultado = await herramienta.ejecutar(args, ctx);
        usadas.push(nombre);
      } catch {
        resultado = { error: 'No se pudo obtener ese dato' };
      }
      msgs.push({ role: 'tool', tool_call_id: llamada.id, content: JSON.stringify(resultado) });
    }
  }

  throw new Error('Demasiadas rondas de herramientas');
}

export async function llamarLLM(
  mensajes: Mensaje[],
  herramientas: HerramientaLLM[],
  ctx: Ctx,
): Promise<RespuestaLLM> {
  try {
    return await conversar(ctx.cfg.llmModelo, mensajes, herramientas, ctx);
  } catch (e) {
    console.error(`Falló ${ctx.cfg.llmModelo}: status=${(e as { status?: number })?.status ?? "sin-status"} motivo=${e instanceof Error ? e.message : String(e)}`);
    if (!ctx.cfg.llmModeloRespaldo || !esErrorReintentable(e)) throw e;
    return await conversar(ctx.cfg.llmModeloRespaldo, mensajes, herramientas, ctx);
  }
}
