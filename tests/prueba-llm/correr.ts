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
import type { ClienteConfig, ContextoConversacion, HerramientaLLM, MensajeEntrante, TurnoEntrante } from '../../src/types/index.js';
import {
  CRITERIOS, evaluar, extraerMontos, resumir,
  type Caso, type Corrida, type Ejecucion, type LlamadaHerramienta,
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
    salida: { type: 'string', default: 'tests/prueba-llm/resultados' },
  },
});

const cuentaChatwoot = Number(values.cuenta);
const repeticiones = Math.max(1, Number(values.rep));
const concurrencia = Math.max(1, Number(values.concurrencia));

// Import dinámico: recién aquí se lee y valida el entorno (ya con el relleno puesto).
const { cargarClientePorChatwootAccount } = await import('../../src/config/cliente.js');
const { llamarLLM } = await import('../../src/llm/llamarLLM.js');
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

/** Montos permitidos para un caso: los fijos + los precios activos + los números que dijo el propio huésped (repetirlos no es inventar). */
function montosPermitidos(base: ReadonlySet<number>, turnos: string[]): Set<number> {
  const set = new Set<number>(base);
  for (const t of turnos) for (const m of extraerMontos(t)) set.add(m);
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

/** Un caso completo (uno o varios mensajes del huésped, en orden) contra UN modelo. Devuelve lo que pasó en cada mensaje. */
async function ejecutarCaso(caso: Caso, modelo: string): Promise<Ejecucion[]> {
  const cfg: ClienteConfig = { ...cfg0, llmModelo: modelo, llmModeloRespaldo: null, openrouterKeyRef: CLAVE_REF };
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
      const r = await llamarLLM(mensajes, herramientas.map((h) => envolver(h, llamadas)), { cfg, conv }, { forzarHerramienta: !saludo });
      salidas.push({
        ...base, texto: r.texto, noSeElDato: r.noSeElDato, llamadas, sinModelo: false,
        latenciaMs: r.latenciaMs, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida,
      });
      if (r.noSeElDato) break; // en producción el bot se pausa: no hay siguiente mensaje
      historial.push({ rol: 'huesped', contenido: texto }, { rol: 'bot', contenido: r.texto });
    } catch (e) {
      salidas.push({ ...base, texto: '', noSeElDato: false, llamadas, sinModelo: false, error: e instanceof Error ? e.message : String(e) });
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
  console.log(`Modelos: ${modelos.join(', ')}${modelos.includes(cfg0.llmModelo) ? `  (referencia: ${cfg0.llmModelo} es el modelo actual del cliente)` : ''}\n`);

  const resumenes: Record<string, ReturnType<typeof resumir>> = {};
  const hallazgosRouter = new Map<string, boolean>();

  for (const modelo of modelos) {
    const tareas = casos.flatMap((caso) => Array.from({ length: repeticiones }, (_, rep) => async () => ({ caso, rep, salidas: await ejecutarCaso(caso, modelo) })));
    const original = { log: console.log, error: console.error };
    const silencio = (): void => undefined;
    let hechas = 0;
    console.log(`▶ ${modelo}`);
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
      const permitidos = montosPermitidos(base, b.caso.turnos);
      const ev = evaluar(b.caso, ultima, { montosPermitidos: permitidos, hoy });
      corridas.push({ caso: b.caso, rep: b.rep, ej: ultima, ev });
      hallazgosRouter.set(b.caso.id, ultima.routerEscala);
      lineas.push(JSON.stringify({ caso: b.caso.id, rep: b.rep, turnos: b.caso.turnos, esperado: b.caso.esperado, salidas: b.salidas, ev }));
    }
    const slug = modelo.replace(/[^a-z0-9.]+/gi, '_');
    await writeFile(`${dir}${slug}.jsonl`, `${lineas.join('\n')}\n`);
    resumenes[modelo] = resumir(corridas);
  }

  await writeFile(`${dir}resumen.json`, JSON.stringify({ marca, hoy, criterios: CRITERIOS, resumenes, precios: PRECIOS }, null, 2));
  await writeFile(`${dir}resumen.md`, resumenEnMarkdown(marca, modelos, resumenes, casos, hallazgosRouter));
  console.log(`\nListo. Resultados en ${dir}`);
  console.log(await readFile(`${dir}resumen.md`, 'utf8'));
}

function resumenEnMarkdown(
  marca: string, modelos: string[], r: Record<string, ReturnType<typeof resumir>>, casos: Caso[], router: Map<string, boolean>,
): string {
  const L: string[] = [`# Resumen prueba LLM ${marca}\n`];
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
  L.push('\n## Hallazgos del router (código, igual para todos los modelos)\n');
  const sinRed = casos.filter((c) => c.esperado === 'escala' && router.get(c.id) === false).map((c) => c.id);
  const deMas = casos.filter((c) => c.esperado !== 'escala' && c.esperado !== 'info_y_recolecta' && router.get(c.id) === true).map((c) => c.id);
  const infoSinRouter = casos.filter((c) => c.esperado === 'info_y_recolecta' && router.get(c.id) === false).map((c) => c.id);
  L.push(`- Deben pasar a una persona y el router NO las atrapa por palabra clave (dependen solo del modelo): ${sinRed.join(', ') || 'ninguno'}`);
  L.push(`- Casos de información + captura de datos que el router NO marca (no se pausaría el bot ni se avisaría al equipo): ${infoSinRouter.join(', ') || 'ninguno'}`);
  L.push(`- Casos normales que el router pausaría por error (falso positivo): ${deMas.join(', ') || 'ninguno'}`);
  return `${L.join('\n')}\n`;
}
