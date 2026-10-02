/**
 * Prueba de LLM (semana 2). Corre el set de preguntas.json contra varios modelos usando el CÓDIGO REAL del cerebro
 * (mismo prompt, mismas herramientas contra Supabase, mismo router). Lo único que cambia es el modelo.
 * SOLO LEE de Supabase (las herramientas solo hacen select). No escribe nada, no toca Chatwoot, Redis ni n8n.
 *
 * Uso (ver tests/prueba-llm/README.md):
 *   npm run prueba:llm -- datos                       revisa qué datos ve el bot (hacer ANTES de correr)
 *   npm run prueba:llm -- --casos A01,R01 --rep 1     prueba de humo
 *   npm run prueba:llm                                prueba completa (4 modelos x 60 casos x 3 repeticiones)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM, MensajeEntrante, TurnoEntrante } from '../../src/types/index.js';
import {
  CRITERIOS, evaluar, extraerMontos, latenciaPorProveedor, montosDeSalidas, resumir,
  type Caso, type Corrida, type Ejecucion, type LatenciaProveedor, type LlamadaHerramienta,
} from './evaluar.js';

/** Clave de OpenRouter SOLO para esta prueba, con tope de gasto propio (no la de Mandala). */
const CLAVE_REF = 'OPENROUTER_KEY_PRUEBA_LLM';

/** El cerebro exige estas variables al arrancar, pero esta prueba no usa Redis, Chatwoot ni n8n. */
const RELLENO: Record<string, string> = {
  REDIS_URL: 'redis://no-se-usa:6379',
  CHATWOOT_BASE_URL: 'https://no-se-usa.invalid',
  CHATWOOT_WEBHOOK_SECRET: 'no-se-usa',
  N8N_WEBHOOK_AVISOS: 'https://no-se-usa.invalid/avisos',
  N8N_WEBHOOK_SECRET: 'no-se-usa',
};
for (const [k, v] of Object.entries(RELLENO)) process.env[k] ??= v;

/** Modelos candidatos (slugs de OpenRouter, verificados el 29-sep-2026). El modelo actual del cliente se agrega solo como referencia. */
const CANDIDATOS = ['qwen/qwen3.8-flash', 'deepseek/deepseek-v4.1-flash', 'google/gemini-3.5-flash-lite'];

/** USD por millón de tokens [entrada, salida]. Precio de lista (29-sep-2026); confirmar en el panel de OpenRouter antes de decidir. */
const PRECIOS: Record<string, [number, number]> = {
  'qwen/qwen3.8-flash': [0.15, 0.47],
  'deepseek/deepseek-v4.1-flash': [0.02, 0.6],
  'google/gemini-3.5-flash-lite': [0.3, 2.5],
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    modelos: { type: 'string' },
    rep: { type: 'string', default: '3' },
    cuenta: { type: 'string', default: '1' },
    casos: { type: 'string' },
    concurrencia: { type: 'string', default: '3' },
    razonamiento: { type: 'string', default: 'auto' },
    salida: { type: 'string', default: 'tests/prueba-llm/resultados' },
  },
});

const cuentaChatwoot = Number(values.cuenta);
const repeticiones = Math.max(1, Number(values.rep));
const concurrencia = Math.max(1, Number(values.concurrencia));
if (values.razonamiento !== 'auto' && values.razonamiento !== 'apagado' && values.razonamiento !== 'normal') {
  console.error('--razonamiento debe ser "auto" (por defecto), "apagado" (se manda a todos) o "normal" (no se manda nada).');
  process.exit(1);
}

type Modo = 'apagado' | 'normal';
const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const estadoDe = (e: unknown): number | undefined => (e as { status?: number })?.status;
const textoDeError = (e: unknown): string => `${e instanceof Error ? e.message : String(e)} ${JSON.stringify((e as { error?: unknown }).error ?? '')}`;

/** Esperas entre reintentos cuando el proveedor limita la velocidad (429). Se cuentan por modelo y se muestran en el resumen. */
const ESPERAS_429_MS = [4_000, 12_000, 30_000];
const reintentos429 = new Map<string, number>();

// Import dinámico: recién aquí se lee y valida el entorno (ya con el relleno puesto).
const { cargarClientePorChatwootAccount } = await import('../../src/config/cliente.js');
const { env, secretoPorRef } = await import('../../src/config/env.js');
const { llamarLLM } = await import('../../src/llm/llamarLLM.js');
const { llamarLLMConReintento } = await import('../../src/llm/conReintento.js');
const { construirSystemPrompt } = await import('../../src/llm/prompt.js');
const { herramientas } = await import('../../src/llm/herramientas/index.js');
const { rutear } = await import('../../src/router/index.js');
const { detectarIdioma, esSoloSaludo } = await import('../../src/router/texto.js');
const { supabase } = await import('../../src/db/supabase.js');

const cfgBase = await cargarClientePorChatwootAccount(cuentaChatwoot);
if (!cfgBase) {
  console.error(`No encontré ningún cliente con chatwoot_account_id=${cuentaChatwoot}. Usa --cuenta con el número de la cuenta de Mandala en Chatwoot.`);
  process.exit(1);
}
const cfg0: ClienteConfig = cfgBase;

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: cfg0.zonaHoraria }).format(new Date());

if (positionals[0] === 'datos') {
  await volcarDatos();
} else if (positionals[0] === 'recalificar') {
  await recalificar(positionals[1]);
} else {
  await correrPrueba();
}
process.exit(0);

// ============================================================================ datos

/** Qué ve el bot HOY en la base. Sirve para saber, antes de gastar, si los casos son justos (¿está India? ¿hay link de reserva?). */
async function volcarDatos(): Promise<void> {
  const tablas = ['faq', 'politicas', 'clases', 'productos', 'eventos', 'habitaciones', 'formularios'] as const;
  const volcado: Record<string, unknown> = {
    fecha: hoy,
    cliente: { slug: cfg0.slug, modelo: cfg0.llmModelo, respaldo: cfg0.llmModeloRespaldo, temperatura: cfg0.llmTemperatura, idiomas: cfg0.idiomas },
    link_reserva_base: cfg0.linkReservaBase,
    temas_que_escalan: cfg0.temasQueEscalan,
    prompt_base: cfg0.promptBase,
  };
  for (const t of tablas) {
    const { data, error } = await supabase.from(t).select('*').eq('cliente_id', cfg0.id);
    volcado[t] = error ? `ERROR: ${error.message}` : data;
  }
  const texto = JSON.stringify(volcado);
  const avisos: string[] = [];
  if (!cfg0.linkReservaBase) avisos.push('link_reserva_base está VACÍO: los casos R01 y G01 no pueden pasar (la herramienta responde error).');
  if (cfg0.promptBase.trim() === '') avisos.push('prompt_base está VACÍO.');
  const busca = (nombre: string, ...pistas: string[]) => {
    const p = texto.toLowerCase();
    if (!pistas.some((x) => p.includes(x))) avisos.push(`No encuentro "${nombre}" en la base ni en el prompt: los casos que dependen de eso fallarían por falta de dato, no por el modelo.`);
  };
  busca('India (fechas/precio)', '2590', '2.590');
  busca('Karmi Yogi / voluntariado', 'karmi');
  busca('tienda (miel / cacao)', 'miel mandala', 'cacao ceremonial');
  busca('"multinivel" / principiantes en clases', 'multinivel', 'principiante');
  busca('formación de 100 horas', '100 horas');
  const dir = new URL('./resultados/', import.meta.url);
  await mkdir(fileURLToPath(dir), { recursive: true });
  const ruta = fileURLToPath(new URL(`datos-${hoy}.json`, dir));
  await writeFile(ruta, JSON.stringify(volcado, null, 2));
  console.log(`Datos guardados en ${ruta}`);
  console.log(avisos.length === 0 ? 'Sin avisos: los datos que necesitan los casos están.' : `\nAVISOS (${avisos.length}):\n- ${avisos.join('\n- ')}`);
}

// ============================================================================ prueba

interface PreguntasJson { casos: Caso[]; montos_fijos_permitidos: number[] }

/** Precios activos hoy en la base: son los únicos montos de yoga que el bot puede decir. */
async function preciosActivos(): Promise<number[]> {
  const { data, error } = await supabase.from('productos').select('precio').eq('cliente_id', cfg0.id).eq('activo', true);
  if (error) throw new Error(`No pude leer productos: ${error.message}`);
  return (data ?? []).flatMap((f) => (typeof f.precio === 'number' ? [f.precio] : []));
}

/** Montos permitidos para un caso: los fijos + los precios activos + los del propio caso + los números que dijo el huésped (repetirlos no es inventar). */
function montosPermitidos(base: ReadonlySet<number>, caso: Caso, salidas: readonly Ejecucion[]): Set<number> {
  const set = new Set<number>([...base, ...(caso.montos_extra ?? []), ...montosDeSalidas(salidas)]);
  for (const t of caso.turnos) for (const m of extraerMontos(t)) set.add(m);
  return set;
}

function envolver(h: HerramientaLLM, registro: LlamadaHerramienta[]): HerramientaLLM {
  return {
    ...h,
    async ejecutar(args, ctx) {
      try {
        const resultado = await h.ejecutar(args, ctx);
        registro.push({ nombre: h.nombre, args, resultado });
        return resultado;
      } catch (e) {
        registro.push({ nombre: h.nombre, args, resultado: { error: e instanceof Error ? e.message : String(e) } });
        throw e;
      }
    },
  };
}

function mensajeEntrante(texto: string): MensajeEntrante {
  return {
    clienteId: cfg0.id, chatwootAccountId: cuentaChatwoot, chatwootConversationId: 0, chatwootContactId: 0, chatwootMessageId: 0,
    canal: 'whatsapp', telefono: null, contenido: texto, tipo: 'texto', recibidoAt: new Date().toISOString(),
  };
}

/**
 * Qué modo de razonamiento usa cada modelo. "apagado" = reasoning.enabled=false: el cerebro obliga a consultar una herramienta en cada
 * mensaje (tool_choice "required") y los modelos que piensan por defecto lo rechazan. Algunos modelos NO permiten apagarlo (Gemini 3.5
 * Flash-Lite: "Reasoning is mandatory"): en modo "auto" se prueba con una llamada mínima y, si lo rechazan, se usa "normal".
 */
async function elegirModo(modelo: string): Promise<Modo> {
  if (values.razonamiento === 'apagado' || values.razonamiento === 'normal') return values.razonamiento;
  const cliente = new OpenAI({ apiKey: secretoPorRef(CLAVE_REF), baseURL: env.OPENROUTER_BASE_URL, timeout: 25_000, maxRetries: 0 });
  for (let intento = 0; intento <= ESPERAS_429_MS.length; intento++) {
    try {
      const cuerpo = { model: modelo, messages: [{ role: 'user', content: 'Responde solo: ok' }], max_tokens: 20, reasoning: { enabled: false } };
      await cliente.chat.completions.create(cuerpo as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      return 'apagado';
    } catch (e) {
      if (/mandatory|cannot be disabled/i.test(textoDeError(e))) return 'normal';
      const espera = ESPERAS_429_MS[intento];
      if (estadoDe(e) === 429 && espera !== undefined) { await pausa(espera); continue; }
      return 'apagado'; // otro error: se deja "apagado" y la prueba real mostrará el problema
    }
  }
  return 'apagado';
}

/** Reintenta si el proveedor limita la velocidad (429). Cualquier otro error se propaga tal cual. */
async function conReintento429(modelo: string, llamadas: LlamadaHerramienta[], fn: () => ReturnType<typeof llamarLLM>): ReturnType<typeof llamarLLM> {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      const espera = ESPERAS_429_MS[intento];
      if (estadoDe(e) !== 429 || espera === undefined) throw e;
      reintentos429.set(modelo, (reintentos429.get(modelo) ?? 0) + 1);
      llamadas.length = 0; // lo que se consultó en el intento fallido no cuenta
      await pausa(espera);
    }
  }
}

/** Un caso completo (uno o varios mensajes del huésped, en orden) contra UN modelo. Devuelve lo que pasó en cada mensaje. */
async function ejecutarCaso(caso: Caso, modelo: string, modo: Modo): Promise<Ejecucion[]> {
  const { llmExtra: _propio, ...configExtraSinExtra } = cfg0.configExtra;
  const cfg: ClienteConfig = {
    ...cfg0, llmModelo: modelo, llmModeloRespaldo: null, openrouterKeyRef: CLAVE_REF,
    configExtra: modo === 'apagado' ? { ...configExtraSinExtra, llmExtra: { reasoning: { enabled: false } } } : configExtraSinExtra,
  };
  const historial: Array<{ rol: 'huesped' | 'bot'; contenido: string }> = [];
  const salidas: Ejecucion[] = [];
  let idioma = cfg.idiomaDefault;

  for (const texto of caso.turnos) {
    idioma = detectarIdioma(texto, idioma, cfg.idiomas);
    const conv: ContextoConversacion = {
      id: 'prueba', clienteId: cfg.id, chatwootConversationId: 0, canal: 'whatsapp', idioma, pais: null,
      estadoBot: 'activo', formularioActivo: null, mensajesSalientesHoy: 0, ultimosMensajes: [...historial],
    };
    const turno: TurnoEntrante = { clienteId: cfg.id, chatwootConversationId: 0, mensajes: [mensajeEntrante(texto)], textoAgrupado: texto };
    const decision = await rutear(turno, conv, cfg);
    const routerEscala = decision.tipo === 'escalar';
    const base = { routerEscala, error: null, latenciaMs: 0, tokensEntrada: 0, tokensSalida: 0 };

    if (decision.tipo === 'escalar' && decision.motivo === 'pidio_humano') {
      salidas.push({ ...base, texto: '', noSeElDato: false, llamadas: [], sinModelo: true });
      break;
    }

    const llamadas: LlamadaHerramienta[] = [];
    const saludo = esSoloSaludo(texto);
    // Espejo de armarMensajes (src/ingesta/atenderTurno.ts). Si cambia allá, cambiar aquí.
    const mensajes = [
      { rol: 'system' as const, contenido: construirSystemPrompt(cfg, conv, saludo) },
      ...historial.map((m) => ({ rol: m.rol === 'huesped' ? ('user' as const) : ('assistant' as const), contenido: m.contenido })),
      { rol: 'user' as const, contenido: texto },
    ];
    try {
      const r = await conReintento429(modelo, llamadas, () => llamarLLMConReintento(mensajes, herramientas.map((h) => envolver(h, llamadas)), { cfg, conv }, { forzarHerramienta: !saludo }));
      salidas.push({
        ...base, texto: r.texto, noSeElDato: r.noSeElDato, llamadas, sinModelo: false,
        latenciaMs: r.latenciaMs, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida, proveedores: r.proveedores,
      });
      if (r.noSeElDato) break; // en producción el bot se pausa: no hay siguiente mensaje
      historial.push({ rol: 'huesped', contenido: texto }, { rol: 'bot', contenido: r.texto });
    } catch (e) {
      // El cuerpo del error (e.error) trae qué proveedor falló y por qué; el mensaje solo dice "Provider returned error".
      const cuerpo = (e as { error?: unknown }).error;
      const detalle = cuerpo === undefined ? '' : ` :: ${JSON.stringify(cuerpo).slice(0, 700)}`;
      salidas.push({ ...base, texto: '', noSeElDato: false, llamadas, sinModelo: false, error: `${e instanceof Error ? e.message : String(e)}${detalle}` });
      break;
    }
  }
  return salidas;
}

async function conLimite<T>(tareas: Array<() => Promise<T>>, limite: number, alAvanzar: (hechas: number) => void): Promise<T[]> {
  const res: T[] = new Array<T>(tareas.length);
  let siguiente = 0;
  let hechas = 0;
  const trabajador = async (): Promise<void> => {
    for (;;) {
      const i = siguiente++;
      const tarea = tareas[i];
      if (!tarea) return;
      res[i] = await tarea();
      alAvanzar(++hechas);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajador));
  return res;
}

/** Errores de la API distintos (con su conteo) y una línea por cada caso que falló, para el resumen. */
function detalleDe(corridas: Corrida[]): { errores: Map<string, number>; fallas: string[] } {
  const errores = new Map<string, number>();
  for (const c of corridas) if (c.ej.error) errores.set(c.ej.error, (errores.get(c.ej.error) ?? 0) + 1);
  const fallas = corridas.filter((c) => !c.ev.ok && !c.ej.error).slice(0, 60).map((c) =>
    `${c.caso.id} (rep ${c.rep + 1}): ${c.ev.detalle.join(' | ')} — noSe=${c.ej.noSeElDato}; herramientas=[${c.ej.llamadas.map((l) => l.nombre).join(', ')}]; texto: «${c.ej.texto.replace(/\s+/g, ' ').slice(0, 220)}»`);
  return { errores, fallas };
}

/**
 * Vuelve a calificar una prueba YA CORRIDA con el preguntas.json y el evaluar.ts de ahora, sin llamar a ningún modelo (gratis).
 * Sirve cuando se corrige un caso mal escrito: las respuestas de los modelos son las mismas, solo cambia cómo se juzgan.
 */
async function recalificar(carpeta: string | undefined): Promise<void> {
  if (!carpeta) {
    console.error('Uso: npm run prueba:llm -- recalificar tests/prueba-llm/resultados/<carpeta>');
    process.exit(1);
  }
  const dir = carpeta.endsWith('/') ? carpeta : `${carpeta}/`;
  const previo = JSON.parse(await readFile(`${dir}resumen.json`, 'utf8')) as {
    marca: string; hoy: string; modos: Record<string, Modo>; reintentos429?: Record<string, number>;
  };
  const set = JSON.parse(await readFile(fileURLToPath(new URL('./preguntas.json', import.meta.url)), 'utf8')) as PreguntasJson;
  const porId = new Map(set.casos.map((c) => [c.id, c]));
  const base = new Set<number>([...set.montos_fijos_permitidos, ...(await preciosActivos())]);
  const modelos = Object.keys(previo.modos);
  for (const [m, n] of Object.entries(previo.reintentos429 ?? {})) reintentos429.set(m, n);

  const resumenes: Record<string, ReturnType<typeof resumir>> = {};
  const porProveedor: Record<string, LatenciaProveedor[]> = {};
  const errores: Record<string, Map<string, number>> = {};
  const fallas: Record<string, string[]> = {};
  const router = new Map<string, boolean>();
  const casosVistos = new Map<string, Caso>();
  for (const modelo of modelos) {
    const archivo = `${dir}${modelo.replace(/[^a-z0-9.]+/gi, '_')}.jsonl`;
    const corridas: Corrida[] = [];
    for (const linea of (await readFile(archivo, 'utf8')).split('\n').filter(Boolean)) {
      const j = JSON.parse(linea) as { caso: string; rep: number; salidas: Ejecucion[] };
      const caso = porId.get(j.caso);
      const ultima = j.salidas[j.salidas.length - 1];
      if (!caso || !ultima) continue;
      const ev = evaluar(caso, ultima, { montosPermitidos: montosPermitidos(base, caso, j.salidas), hoy: previo.hoy });
      corridas.push({ caso, rep: j.rep, ej: ultima, ev });
      router.set(caso.id, ultima.routerEscala);
      casosVistos.set(caso.id, caso);
    }
    resumenes[modelo] = resumir(corridas);
    porProveedor[modelo] = latenciaPorProveedor(corridas);
    const d = detalleDe(corridas);
    errores[modelo] = d.errores;
    fallas[modelo] = d.fallas;
  }
  const md = resumenEnMarkdown(`${previo.marca} (recalificada)`, modelos, resumenes, [...casosVistos.values()], router, errores, previo.modos, fallas, porProveedor);
  await writeFile(`${dir}resumen-recalificado.md`, md);
  await writeFile(`${dir}resumen-recalificado.json`, JSON.stringify({ marca: previo.marca, hoy: previo.hoy, modos: previo.modos, criterios: CRITERIOS, resumenes, porProveedor, precios: PRECIOS }, null, 2));
  console.log(`Recalificada sin gastar nada. Guardado en ${dir}resumen-recalificado.md\n`);
  console.log(md);
}

async function correrPrueba(): Promise<void> {
  if (!process.env[CLAVE_REF]) {
    console.error(`Falta la variable ${CLAVE_REF} (clave de OpenRouter para esta prueba, con tope de gasto). Ponla en tu .env local.`);
    process.exit(1);
  }
  const archivo = fileURLToPath(new URL('./preguntas.json', import.meta.url));
  const set = JSON.parse(await readFile(archivo, 'utf8')) as PreguntasJson;
  const ids = values.casos?.split(',').map((s) => s.trim());
  const casos = ids ? set.casos.filter((c) => ids.includes(c.id)) : set.casos;
  if (casos.length === 0) throw new Error('Ningún caso coincide con --casos');
  const base = new Set<number>([...set.montos_fijos_permitidos, ...(await preciosActivos())]);
  const modelos = values.modelos ? values.modelos.split(',').map((s) => s.trim()) : [...new Set([cfg0.llmModelo, ...CANDIDATOS])];

  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = fileURLToPath(new URL(`./resultados/${marca}/`, import.meta.url));
  await mkdir(dir, { recursive: true });
  console.log(`Prueba ${marca}: ${modelos.length} modelos x ${casos.length} casos x ${repeticiones} repeticiones = ${modelos.length * casos.length * repeticiones} corridas`);
  console.log(`Razonamiento: ${values.razonamiento === 'auto' ? 'automático (se apaga si el modelo lo permite)' : values.razonamiento}`);
  console.log(`Modelos: ${modelos.join(', ')}${modelos.includes(cfg0.llmModelo) ? `  (referencia: ${cfg0.llmModelo} es el modelo actual del cliente)` : ''}\n`);

  const resumenes: Record<string, ReturnType<typeof resumir>> = {};
  const porProveedor: Record<string, LatenciaProveedor[]> = {};
  const errores: Record<string, Map<string, number>> = {};
  const modos: Record<string, Modo> = {};
  const fallas: Record<string, string[]> = {};
  const hallazgosRouter = new Map<string, boolean>();

  for (const modelo of modelos) {
    const modo = await elegirModo(modelo);
    modos[modelo] = modo;
    const tareas = casos.flatMap((caso) => Array.from({ length: repeticiones }, (_, rep) => async () => ({ caso, rep, salidas: await ejecutarCaso(caso, modelo, modo) })));
    const original = { log: console.log, error: console.error };
    const silencio = (): void => undefined;
    let hechas = 0;
    console.log(`▶ ${modelo} (razonamiento ${modo})`);
    console.log = silencio; console.error = silencio; // llamarLLM imprime cada herramienta; aquí estorba
    let brutas: Awaited<ReturnType<(typeof tareas)[number]>>[];
    try {
      brutas = await conLimite(tareas, concurrencia, (n) => { hechas = n; if (n % 20 === 0) original.log(`  ${n}/${tareas.length}`); });
    } finally {
      console.log = original.log; console.error = original.error;
    }
    original.log(`  ${hechas}/${tareas.length} listas`);

    const corridas: Corrida[] = [];
    const lineas: string[] = [];
    for (const b of brutas) {
      const ultima = b.salidas[b.salidas.length - 1];
      if (!ultima) continue;
      const permitidos = montosPermitidos(base, b.caso, b.salidas);
      const ev = evaluar(b.caso, ultima, { montosPermitidos: permitidos, hoy });
      corridas.push({ caso: b.caso, rep: b.rep, ej: ultima, ev });
      hallazgosRouter.set(b.caso.id, ultima.routerEscala);
      lineas.push(JSON.stringify({ caso: b.caso.id, rep: b.rep, turnos: b.caso.turnos, esperado: b.caso.esperado, salidas: b.salidas, ev }));
    }
    const slug = modelo.replace(/[^a-z0-9.]+/gi, '_');
    await writeFile(`${dir}${slug}.jsonl`, `${lineas.join('\n')}\n`);
    resumenes[modelo] = resumir(corridas);
    porProveedor[modelo] = latenciaPorProveedor(corridas);
    const detalle = detalleDe(corridas);
    errores[modelo] = detalle.errores;
    fallas[modelo] = detalle.fallas;
  }

  await writeFile(`${dir}resumen.json`, JSON.stringify({ marca, hoy, razonamiento: values.razonamiento, modos, reintentos429: Object.fromEntries(reintentos429), criterios: CRITERIOS, resumenes, porProveedor, precios: PRECIOS }, null, 2));
  await writeFile(`${dir}resumen.md`, resumenEnMarkdown(marca, modelos, resumenes, casos, hallazgosRouter, errores, modos, fallas, porProveedor));
  console.log(`\nListo. Resultados en ${dir}`);
  console.log(await readFile(`${dir}resumen.md`, 'utf8'));
}

function resumenEnMarkdown(
  marca: string, modelos: string[], r: Record<string, ReturnType<typeof resumir>>, casos: Caso[], router: Map<string, boolean>,
  errores: Record<string, Map<string, number>>, modos: Record<string, Modo>, fallas: Record<string, string[]>,
  porProveedor: Record<string, LatenciaProveedor[]>,
): string {
  const L: string[] = [`# Resumen prueba LLM ${marca}\n`, `Razonamiento pedido: **${values.razonamiento}**\n`];
  L.push('Criterios (fijados antes de correr): monto inventado 0 · dijo algo prohibido 0 · escalamiento correcto ≥95% · falsa escalación ≤5% · herramienta correcta ≥95% · consistencia ≥90% · errores API ≤2% · latencia p95 ≤12 s\n');
  L.push('| Modelo | Aprobadas | Montos inventados | Prohibido | Escala bien | Falsa escal. | Herramienta | Consistencia | Error API | p50 / p95 | USD por 1000 turnos | Veredicto |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of modelos) {
    const x = r[m];
    if (!x) continue;
    const p = PRECIOS[m];
    const costo = p ? `~${(((x.tokensEntradaProm * p[0] + x.tokensSalidaProm * p[1]) / 1_000_000) * 1000).toFixed(2)}` : 'n/d';
    const n = (v: number | null) => (v === null ? '—' : `${v}%`);
    L.push(`| ${m} | ${x.aprobadasPct}% | ${x.montosInventados} | ${x.prohibido} | ${n(x.escalamientoCorrectoPct)} | ${x.falsaEscalacionPct}% | ${n(x.herramientaCorrectaPct)} | ${x.consistenciaPct}% | ${x.errorApiPct}% | ${(x.latenciaP50Ms / 1000).toFixed(1)} s / ${(x.latenciaP95Ms / 1000).toFixed(1)} s | ${costo} | ${x.veredicto.pasa ? 'PASA' : 'NO PASA'} |`);
  }
  L.push('\n## Por qué no pasa\n');
  for (const m of modelos) {
    const x = r[m];
    if (x && !x.veredicto.pasa) L.push(`- **${m}**: ${x.veredicto.incumplidos.join('; ')}`);
  }
  L.push('\n## Aprobadas por categoría\n');
  const cats = [...new Set(casos.map((c) => c.categoria))];
  L.push(`| Modelo | ${cats.join(' | ')} |`);
  L.push(`|---|${cats.map(() => '---').join('|')}|`);
  for (const m of modelos) {
    const x = r[m];
    if (x) L.push(`| ${m} | ${cats.map((c) => `${x.porCategoria[c]?.aprobadasPct ?? '—'}%`).join(' | ')} |`);
  }
  L.push('\n## Razonamiento usado y límites de velocidad\n');
  for (const m of modelos) L.push(`- ${m}: razonamiento **${modos[m] ?? '—'}**${modos[m] === 'normal' && values.razonamiento === 'auto' ? ' (el proveedor no deja apagarlo)' : ''}; reintentos por límite de velocidad (429): ${reintentos429.get(m) ?? 0}`);
  L.push('\n## Latencia por proveedor (quién respondió; "A + B" = la consulta pasó por varios)\n');
  for (const m of modelos) {
    L.push(`**${m}**`);
    L.push('| Proveedor | Consultas | p50 | p95 |', '|---|---|---|---|');
    for (const f of porProveedor[m] ?? []) L.push(`| ${f.proveedor} | ${f.corridas} | ${(f.p50Ms / 1000).toFixed(1)} s | ${(f.p95Ms / 1000).toFixed(1)} s |`);
  }
  const conFallas = modelos.filter((m) => (fallas[m]?.length ?? 0) > 0);
  if (conFallas.length > 0) {
    L.push('\n## Fallas por caso (sin contar errores de la API)\n');
    for (const m of conFallas) {
      L.push(`**${m}**`);
      for (const f of fallas[m] ?? []) L.push(`- ${f}`);
    }
  }
  const conErrores = modelos.filter((m) => (errores[m]?.size ?? 0) > 0);
  if (conErrores.length > 0) {
    L.push('\n## Errores de la API (cuerpo completo)\n');
    for (const m of conErrores) {
      L.push(`**${m}**`);
      for (const [msg, n] of errores[m] ?? []) L.push(`- (${n}x) ${msg}`);
    }
  }
  L.push('\n## Hallazgos del router (código, igual para todos los modelos)\n');
  const sinRed = casos.filter((c) => c.esperado === 'escala' && router.get(c.id) === false).map((c) => c.id);
  const deMas = casos.filter((c) => c.esperado !== 'escala' && c.esperado !== 'info_y_recolecta' && router.get(c.id) === true).map((c) => c.id);
  const infoSinRouter = casos.filter((c) => c.esperado === 'info_y_recolecta' && router.get(c.id) === false).map((c) => c.id);
  L.push(`- Deben pasar a una persona y el router NO las atrapa por palabra clave (dependen solo del modelo): ${sinRed.join(', ') || 'ninguno'}`);
  L.push(`- Casos de información + captura de datos que el router NO marca (no se pausaría el bot ni se avisaría al equipo): ${infoSinRouter.join(', ') || 'ninguno'}`);
  L.push(`- Casos normales que el router pausaría por error (falso positivo): ${deMas.join(', ') || 'ninguno'}`);
  return `${L.join('\n')}\n`;
}
