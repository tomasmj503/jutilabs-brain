import OpenAI from 'openai';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM, RespuestaLLM } from '../types/index.js';
import { env, secretoPorRef } from '../config/env.js';
import { parametrosExtra } from './parametrosExtra.js';
import { causaDelCorte, esCorteDeConexion } from './corteDeConexion.js';

const MARCA_NO_SE = '[[NO_SE]]';
const MAX_RONDAS_HERRAMIENTAS = 3;
const TIMEOUT_MS = 25000;
const PAUSA_REINTENTO_CONEXION_MS = 500;

type Mensaje = { rol: 'system' | 'user' | 'assistant'; contenido: string };
type MensajeAPI = OpenAI.Chat.ChatCompletionMessageParam;
type Ctx = { cfg: ClienteConfig; conv: ContextoConversacion };

function esErrorReintentable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === undefined) return true;
  return status >= 500 || status === 429;
}

/**
 * Una llamada al modelo. Si la conexión se corta (sin código HTTP, no tiempo agotado) se repite UNA vez con el mismo modelo
 * antes de pasar al respaldo: es solo la llamada, no el turno (las herramientas ya consultadas no se repiten).
 * Deja una línea en el log para medir cuántas veces pasa en el piloto.
 */
async function crearConReintento(
  cliente: OpenAI, cuerpo: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, modelo: string, ronda: number,
): Promise<OpenAI.Chat.ChatCompletion> {
  const inicio = Date.now();
  try {
    return await cliente.chat.completions.create(cuerpo);
  } catch (e) {
    if (!esCorteDeConexion(e)) throw e;
    console.error(`LLM REINTENTO CONEXION modelo=${modelo} ronda=${ronda} tras=${Date.now() - inicio}ms causa=${causaDelCorte(e)}`);
    await new Promise((r) => setTimeout(r, PAUSA_REINTENTO_CONEXION_MS));
    return await cliente.chat.completions.create(cuerpo);
  }
}

async function conversar(
  modelo: string,
  mensajes: Mensaje[],
  herramientas: HerramientaLLM[],
  ctx: Ctx,
  forzarHerramienta: boolean,
): Promise<RespuestaLLM> {
  const cliente = new OpenAI({
    apiKey: secretoPorRef(ctx.cfg.openrouterKeyRef),
    baseURL: env.OPENROUTER_BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  const inicio = Date.now();
  const msgs: MensajeAPI[] = mensajes.map((m) => ({ role: m.rol, content: m.contenido }));
  const aTools = (hs: HerramientaLLM[]) => hs.map((h) => ({
    type: 'function' as const,
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }));
  const toolsTodas = aTools(herramientas);
  // En la ronda obligatoria solo van las de consulta: las de acción (pasar_a_persona) se ofrecen después de consultar.
  const toolsPrimeraRonda = aTools(herramientas.filter((h) => !h.soloTrasConsultar));
  const usadas: string[] = [];
  let tokensEntrada = 0;
  let tokensSalida = 0;
  const proveedores: string[] = [];

  for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
    const rondaForzada = forzarHerramienta && ronda === 0;
    const tools = rondaForzada && toolsPrimeraRonda.length > 0 ? toolsPrimeraRonda : toolsTodas;
    const puedeUsarHerramientas = tools.length > 0 && ronda < MAX_RONDAS_HERRAMIENTAS;

    const cuerpo = {
      // Parámetros extra del cliente (ej. reasoning). Van primero: nada de lo de abajo se puede pisar.
      ...parametrosExtra(ctx.cfg),
      model: modelo,
      messages: msgs,
      temperature: ctx.cfg.llmTemperatura,
      max_tokens: 500,
      // Primera ronda: el modelo DEBE consultar una herramienta (no puede responder de memoria).
      ...(puedeUsarHerramientas ? { tools, tool_choice: rondaForzada ? ('required' as const) : ('auto' as const) } : {}),
    };
    const r = await crearConReintento(cliente, cuerpo as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, modelo, ronda);

    // OpenRouter agrega "provider" a la respuesta (no está en el tipo de OpenAI).
    proveedores.push((r as { provider?: string }).provider || 'desconocido');
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
        proveedores,
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
        console.log(`HERRAMIENTA ${nombre} args=${JSON.stringify(args)} resultado=${JSON.stringify(resultado).slice(0, 400)}`);
        usadas.push(nombre);
      } catch (e) {
        console.error(`HERRAMIENTA FALLÓ ${nombre}:`, e instanceof Error ? e.message : e);
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
  opciones: { forzarHerramienta?: boolean } = {},
): Promise<RespuestaLLM> {
  const forzar = opciones.forzarHerramienta ?? true;
  try {
    return await conversar(ctx.cfg.llmModelo, mensajes, herramientas, ctx, forzar);
  } catch (e) {
    console.error(`Falló ${ctx.cfg.llmModelo}: status=${(e as { status?: number })?.status ?? "sin-status"} motivo=${e instanceof Error ? e.message : String(e)}`);
    if (!ctx.cfg.llmModeloRespaldo || !esErrorReintentable(e)) throw e;
    return await conversar(ctx.cfg.llmModeloRespaldo, mensajes, herramientas, ctx, forzar);
  }
}
