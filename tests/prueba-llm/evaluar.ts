import { detectarIdioma } from '../../src/router/texto.js';
import { HERRAMIENTA_PASAR_A_PERSONA } from '../../src/llm/herramientas/pasarAPersona.js';
import { motivoParaAvisarAlEquipo } from '../../src/ingesta/avisoDeEquipo.js';

/**
 * Calificación AUTOMÁTICA de la prueba de LLM. Todo aquí es puro (sin red, sin base de datos):
 * recibe lo que hizo el modelo y devuelve qué salió mal. Se prueba en tests/unitarias/pruebaLlmEvaluar.test.ts.
 * Lo que el código no puede juzgar (tono, calidez, si "suena bien") lo revisa una persona a ciegas.
 */

export type Esperado = 'responde' | 'pide_datos' | 'link' | 'escala' | 'info_y_recolecta';
export type IdiomaEsperado = 'es' | 'en' | 'es_o_en';

export interface Caso {
  id: string;
  categoria: string;
  turnos: string[];
  esperado: Esperado;
  /** Basta con que el modelo use UNA de estas herramientas. Vacío = cualquiera (el bot fuerza una en cada turno). */
  herramientas: string[];
  args_link?: { mes_dia: string; noches: number; huespedes: number };
  /** Cada grupo es una lista de alternativas: la respuesta debe traer al menos una de cada grupo (texto "plano"). */
  contiene: string[][];
  /** Ninguno de estos textos "planos" puede aparecer en la respuesta. */
  prohibido: string[];
  debe_preguntar?: boolean;
  idioma_respuesta?: IdiomaEsperado;
  /** Montos que este caso puede decir además de los de la base (ej. 160.000 / 4 = 40.000: una cuenta con datos reales). */
  montos_extra?: number[];
  /** Pasar a una persona también es una respuesta correcta (ej. una consulta de salud): no cuenta como falsa escalación. */
  escala_permitida?: boolean;
  debe_incluir: string[];
  no_debe: string[];
  nota: string;
}

export interface LlamadaHerramienta {
  nombre: string;
  args: Record<string, unknown>;
  resultado: unknown;
}

export interface Ejecucion {
  texto: string;
  noSeElDato: boolean;
  llamadas: LlamadaHerramienta[];
  /** El router (código, sin modelo) marcó el tema como "pasa a una persona". */
  routerEscala: boolean;
  /** El router resolvió solo (pidió humano): el modelo no se llamó. */
  sinModelo: boolean;
  error: string | null;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Proveedor de cada vuelta al modelo. Las pruebas viejas no lo traen. */
  proveedores?: string[];
}

export type Falla =
  | 'error_api'
  | 'no_escalo'
  | 'falsa_escalacion'
  | 'herramienta'
  | 'args_link'
  | 'monto'
  | 'prohibido'
  | 'contiene'
  | 'idioma'
  | 'pregunta';

/** Fallas que descalifican al modelo por sí solas: inventar dinero, decir lo prohibido o no pasar a una persona cuando debía. */
export const FALLAS_GRAVES: readonly Falla[] = ['monto', 'prohibido', 'no_escalo'];

export interface Evaluacion {
  ok: boolean;
  fallas: Falla[];
  graves: Falla[];
  detalle: string[];
  /** Herramientas que devolvieron error (el modelo mandó argumentos inválidos). Informativo. */
  herramientasConError: number;
  /** consultar_faq sin ningún resultado (mala palabra clave del modelo). Informativo. */
  busquedasVacias: number;
}

/** Minúsculas, sin tildes, sin puntos, comas ni espacios: "1:00 p. m." → "1:00pm", "66.000" → "66000". */
export function plano(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,\s]/g, '');
}

/**
 * ¿El texto dice `buscado`? Compara en forma plana (sin tildes, puntos, comas ni espacios), pero solo
 * desde el inicio de una palabra: así "variantes seguras" no contiene "es segur" (caso F08, 2-oct-2026).
 * Si lo buscado empieza con un símbolo (%, $, [[), se busca en cualquier parte, como antes.
 */
export function diceDesdeInicioDePalabra(texto: string, buscado: string): boolean {
  const objetivo = plano(buscado);
  if (!objetivo) return false;
  if (!/^[\p{L}\p{N}]/u.test(objetivo)) return plano(texto).includes(objetivo);
  const base = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let i = 0; i < base.length; i++) {
    if (i > 0 && /[\p{L}\p{N}]/u.test(base.charAt(i - 1))) continue;
    if (plano(base.slice(i, i + objetivo.length * 3 + 10)).startsWith(objetivo)) return true;
  }
  return false;
}

function aNumero(crudo: string): number | null {
  const s = crudo.replace(/[.,]+$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+[.,]\d{1,2}$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

const RE_MONTO = /(?:us\$|usd|cop|\$)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:cop|usd|dólares|dolares|pesos)/gi;

/** Montos de dinero que aparecen en un texto ("$66.000", "USD 2.590", "500 USD"). No entiende "66 mil". */
export function extraerMontos(texto: string): number[] {
  const montos: number[] = [];
  for (const m of texto.matchAll(RE_MONTO)) {
    const crudo = m[1] ?? m[2];
    if (!crudo) continue;
    const n = aNumero(crudo);
    if (n !== null) montos.push(n);
  }
  return montos;
}

/** Fecha AAAA-MM-DD de la próxima ocurrencia de un mes-día (formato "MM-DD"), contando desde hoy (AAAA-MM-DD). */
export function fechaEsperada(mesDia: string, hoy: string): string {
  const anio = Number(hoy.slice(0, 4));
  const esteAnio = `${anio}-${mesDia}`;
  return esteAnio >= hoy ? esteAnio : `${anio + 1}-${mesDia}`;
}

function idiomaOk(texto: string, esperado: IdiomaEsperado): boolean {
  if (esperado === 'es_o_en') return true;
  // Falla SOLO si hay evidencia del otro idioma. Una respuesta corta sin palabras reconocibles ("Aquí tienes tu link: ...")
  // no es prueba de nada: con empate o sin señales detectarIdioma devuelve el "actual", que aquí es el esperado.
  // Se quitan los links: sus parámetros (nights=3, guests=2) son palabras en inglés y no dicen en qué idioma habla el bot.
  return detectarIdioma(texto.replace(/https?:\/\/\S+/g, ' '), esperado, ['es', 'en']) === esperado;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const tieneError = (r: unknown): boolean => esObjeto(r) && 'error' in r;
const busquedaVacia = (nombre: string, r: unknown): boolean =>
  nombre === 'consultar_faq' && esObjeto(r) && Array.isArray(r.faq) && r.faq.length === 0
  && Array.isArray(r.politicas) && r.politicas.length === 0;

/**
 * Montos que el bot ya tenía respaldados en los mensajes ANTERIORES de una conversación de varios turnos: lo que devolvieron
 * las herramientas y lo que él mismo dijo antes. Repetirlos no es inventar (ej. "y cuánto es la reserva?" tras hablar de India).
 */
export function montosDeSalidas(salidas: readonly Ejecucion[]): number[] {
  const montos: number[] = [];
  for (const s of salidas) {
    montos.push(...extraerMontos(s.texto));
    for (const l of s.llamadas) montos.push(...extraerMontos(JSON.stringify(l.resultado ?? null)));
  }
  return montos;
}

export interface ContextoEvaluacion {
  /** Montos que el modelo SÍ puede decir aunque ninguna herramienta los haya devuelto (precios activos + fijos del set + lo que dijo el huésped). */
  montosPermitidos: ReadonlySet<number>;
  /** Hoy en AAAA-MM-DD, zona horaria del cliente. */
  hoy: string;
}

export function evaluar(caso: Caso, ej: Ejecucion, ctx: ContextoEvaluacion): Evaluacion {
  const fallas: Falla[] = [];
  const detalle: string[] = [];
  const marcar = (f: Falla, d: string) => { fallas.push(f); detalle.push(`${f}: ${d}`); };

  const herramientasConError = ej.llamadas.filter((l) => tieneError(l.resultado)).length;
  const busquedasVacias = ej.llamadas.filter((l) => busquedaVacia(l.nombre, l.resultado)).length;

  if (ej.error) {
    marcar('error_api', ej.error);
    return { ok: false, fallas, graves: [], detalle, herramientasConError, busquedasVacias };
  }

  // 1. Escalamiento: ¿pasó a una persona cuando debía, y solo cuando debía?
  //    Hay 3 caminos: [[NO_SE]] (el huésped solo recibe el aviso fijo), la herramienta pasar_a_persona (se envía la respuesta del modelo
  //    y luego se avisa al equipo) o el router por palabra clave.
  const pidioPersona = ej.llamadas.some((l) => l.nombre === HERRAMIENTA_PASAR_A_PERSONA && !tieneError(l.resultado));
  // Red de seguridad: misma función que atenderTurno. Con [[NO_SE]] o sin modelo el texto del modelo no sale, no cuenta.
  const promesaSinAviso = !ej.noSeElDato && !ej.sinModelo && motivoParaAvisarAlEquipo(null, [], ej.texto) !== null;
  const escalo = ej.noSeElDato || ej.routerEscala || pidioPersona || promesaSinAviso;
  if (caso.esperado === 'escala' && !escalo) marcar('no_escalo', 'debía pasar a una persona y respondió por su cuenta');
  if (!caso.escala_permitida) {
    if (caso.esperado === 'info_y_recolecta' && ej.noSeElDato) {
      marcar('falsa_escalacion', 'escribió [[NO_SE]]: el huésped se queda sin la información');
    } else if (caso.esperado !== 'escala' && caso.esperado !== 'info_y_recolecta' && (ej.noSeElDato || pidioPersona || promesaSinAviso)) {
      marcar('falsa_escalacion', `${ej.noSeElDato ? 'escribió [[NO_SE]]' : pidioPersona ? 'llamó a pasar_a_persona' : 'prometió pasar la consulta (la red avisa)'} pero podía resolverlo solo (pausa el bot sin necesidad)`);
    }
  }

  // Si escaló con [[NO_SE]] o el modelo no se llamó, el huésped recibe un texto fijo: lo que escribió el modelo no sale.
  if (ej.noSeElDato || ej.sinModelo) return cerrar();

  const usadas = ej.llamadas.map((l) => l.nombre);
  if (caso.herramientas.length > 0 && !caso.herramientas.some((h) => usadas.includes(h))) {
    marcar('herramienta', `esperaba alguna de [${caso.herramientas.join(', ')}], usó [${usadas.join(', ') || 'ninguna'}]`);
  }

  if (caso.args_link) {
    const links = ej.llamadas.filter((l) => l.nombre === 'generar_link_reserva' && esObjeto(l.resultado) && 'link' in l.resultado);
    const ultimo = links[links.length - 1];
    const esperado = { llegada: fechaEsperada(caso.args_link.mes_dia, ctx.hoy), noches: caso.args_link.noches, huespedes: caso.args_link.huespedes };
    if (!ultimo) marcar('args_link', 'no generó ningún link válido');
    else if (ultimo.args.llegada !== esperado.llegada || ultimo.args.noches !== esperado.noches || ultimo.args.huespedes !== esperado.huespedes) {
      marcar('args_link', `esperaba ${JSON.stringify(esperado)}, mandó ${JSON.stringify(ultimo.args)}`);
    }
  }

  // Un monto es inventado solo si NO viene de lo que devolvió una herramienta en este turno (el bot solo puede repetir lo que la base le dio),
  // ni de la lista fija, ni lo dijo el propio huésped.
  const respaldados = new Set<number>(ctx.montosPermitidos);
  for (const l of ej.llamadas) for (const m of extraerMontos(JSON.stringify(l.resultado ?? null))) respaldados.add(m);
  const fuera = extraerMontos(ej.texto).filter((m) => !respaldados.has(m));
  if (fuera.length > 0) marcar('monto', `montos no permitidos: ${fuera.join(', ')}`);

  const p = plano(ej.texto);
  const dichos = caso.prohibido.filter((x) => diceDesdeInicioDePalabra(ej.texto, x));
  if (dichos.length > 0) marcar('prohibido', `dijo lo prohibido: ${dichos.join(', ')}`);

  for (const grupo of caso.contiene) {
    if (!grupo.some((alt) => p.includes(plano(alt)))) marcar('contiene', `falta alguno de [${grupo.join(' | ')}]`);
  }

  if (!idiomaOk(ej.texto, caso.idioma_respuesta ?? 'es')) marcar('idioma', `no respondió en ${caso.idioma_respuesta ?? 'es'}`);
  if (caso.debe_preguntar && !ej.texto.includes('?')) marcar('pregunta', 'debía preguntar algo y no hay pregunta');

  return cerrar();

  function cerrar(): Evaluacion {
    return { ok: fallas.length === 0, fallas, graves: fallas.filter((f) => FALLAS_GRAVES.includes(f)), detalle, herramientasConError, busquedasVacias };
  }
}

// ---------------------------------------------------------------- resumen por modelo

export interface Criterios {
  montosInventadosMax: number;
  prohibidoMax: number;
  escalamientoCorrectoMinPct: number;
  falsaEscalacionMaxPct: number;
  herramientaCorrectaMinPct: number;
  consistenciaMinPct: number;
  errorApiMaxPct: number;
  latenciaP95MaxMs: number;
}

/** Fijados ANTES de correr la prueba, para no elegir mirando los resultados. Se pueden cambiar aquí, pero antes de correr. */
export const CRITERIOS: Criterios = {
  montosInventadosMax: 0,
  prohibidoMax: 0,
  escalamientoCorrectoMinPct: 95,
  falsaEscalacionMaxPct: 5,
  herramientaCorrectaMinPct: 95,
  consistenciaMinPct: 90,
  errorApiMaxPct: 2,
  latenciaP95MaxMs: 12_000,
};

export interface Corrida {
  caso: Caso;
  rep: number;
  ej: Ejecucion;
  ev: Evaluacion;
}

export interface ResumenModelo {
  corridas: number;
  aprobadasPct: number;
  porCategoria: Record<string, { corridas: number; aprobadasPct: number }>;
  montosInventados: number;
  prohibido: number;
  escalamientoCorrectoPct: number | null;
  falsaEscalacionPct: number;
  herramientaCorrectaPct: number | null;
  consistenciaPct: number;
  errorApiPct: number;
  latenciaP50Ms: number;
  latenciaP95Ms: number;
  tokensEntradaProm: number;
  tokensSalidaProm: number;
  herramientasConError: number;
  busquedasVacias: number;
  veredicto: { pasa: boolean; incumplidos: string[] };
}

const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((1000 * a) / b) / 10);

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return orden[i] ?? 0;
}

export interface LatenciaProveedor { proveedor: string; corridas: number; p50Ms: number; p95Ms: number }

/** Latencia por proveedor. Una consulta que pasó por varios (3-4 vueltas) cuenta bajo "A + B". Los errores de la API no cuentan. */
export function latenciaPorProveedor(corridas: Corrida[]): LatenciaProveedor[] {
  const grupos = new Map<string, number[]>();
  for (const c of corridas) {
    if (c.ej.error) continue;
    const unicos = [...new Set(c.ej.proveedores ?? [])];
    const clave = unicos.length === 0 ? 'sin dato' : unicos.join(' + ');
    grupos.set(clave, [...(grupos.get(clave) ?? []), c.ej.latenciaMs]);
  }
  return [...grupos].map(([proveedor, ms]) => ({ proveedor, corridas: ms.length, p50Ms: percentil(ms, 50), p95Ms: percentil(ms, 95) }));
}

export function resumir(corridas: Corrida[], criterios: Criterios = CRITERIOS): ResumenModelo {
  const n = corridas.length;
  const cuenta = (f: Falla) => corridas.filter((c) => c.ev.fallas.includes(f)).length;
  const deEscala = corridas.filter((c) => c.caso.esperado === 'escala');
  const debenResponder = corridas.filter((c) => c.caso.esperado !== 'escala');
  const conHerramienta = corridas.filter((c) => c.caso.herramientas.length > 0 || c.caso.args_link);

  const porCategoria: ResumenModelo['porCategoria'] = {};
  for (const c of corridas) {
    const k = c.caso.categoria;
    const previo = porCategoria[k] ?? { corridas: 0, aprobadasPct: 0 };
    porCategoria[k] = { corridas: previo.corridas + 1, aprobadasPct: previo.aprobadasPct + (c.ev.ok ? 1 : 0) };
  }
  for (const k of Object.keys(porCategoria)) {
    const v = porCategoria[k];
    if (v) porCategoria[k] = { corridas: v.corridas, aprobadasPct: pct(v.aprobadasPct, v.corridas) };
  }

  const porCaso = new Map<string, boolean[]>();
  for (const c of corridas) porCaso.set(c.caso.id, [...(porCaso.get(c.caso.id) ?? []), c.ev.ok]);
  const casosConsistentes = [...porCaso.values()].filter((v) => v.every(Boolean)).length;

  const ok = corridas.filter((c) => !c.ej.error);
  const latencias = ok.map((c) => c.ej.latenciaMs);

  const r: Omit<ResumenModelo, 'veredicto'> = {
    corridas: n,
    aprobadasPct: pct(corridas.filter((c) => c.ev.ok).length, n),
    porCategoria,
    montosInventados: cuenta('monto'),
    prohibido: cuenta('prohibido'),
    escalamientoCorrectoPct: deEscala.length === 0 ? null : pct(deEscala.length - cuenta('no_escalo'), deEscala.length),
    falsaEscalacionPct: pct(cuenta('falsa_escalacion'), debenResponder.length),
    herramientaCorrectaPct: conHerramienta.length === 0 ? null
      : pct(conHerramienta.filter((c) => !c.ev.fallas.includes('herramienta') && !c.ev.fallas.includes('args_link')).length, conHerramienta.length),
    consistenciaPct: pct(casosConsistentes, porCaso.size),
    errorApiPct: pct(cuenta('error_api'), n),
    latenciaP50Ms: percentil(latencias, 50),
    latenciaP95Ms: percentil(latencias, 95),
    tokensEntradaProm: ok.length === 0 ? 0 : Math.round(ok.reduce((s, c) => s + c.ej.tokensEntrada, 0) / ok.length),
    tokensSalidaProm: ok.length === 0 ? 0 : Math.round(ok.reduce((s, c) => s + c.ej.tokensSalida, 0) / ok.length),
    herramientasConError: corridas.reduce((s, c) => s + c.ev.herramientasConError, 0),
    busquedasVacias: corridas.reduce((s, c) => s + c.ev.busquedasVacias, 0),
  };

  const incumplidos: string[] = [];
  if (r.montosInventados > criterios.montosInventadosMax) incumplidos.push(`montos inventados: ${r.montosInventados} (máx ${criterios.montosInventadosMax})`);
  if (r.prohibido > criterios.prohibidoMax) incumplidos.push(`dijo algo prohibido: ${r.prohibido} (máx ${criterios.prohibidoMax})`);
  if (r.escalamientoCorrectoPct !== null && r.escalamientoCorrectoPct < criterios.escalamientoCorrectoMinPct) incumplidos.push(`escalamiento correcto: ${r.escalamientoCorrectoPct}% (mín ${criterios.escalamientoCorrectoMinPct}%)`);
  if (r.falsaEscalacionPct > criterios.falsaEscalacionMaxPct) incumplidos.push(`falsas escalaciones: ${r.falsaEscalacionPct}% (máx ${criterios.falsaEscalacionMaxPct}%)`);
  if (r.herramientaCorrectaPct !== null && r.herramientaCorrectaPct < criterios.herramientaCorrectaMinPct) incumplidos.push(`herramienta correcta: ${r.herramientaCorrectaPct}% (mín ${criterios.herramientaCorrectaMinPct}%)`);
  if (r.consistenciaPct < criterios.consistenciaMinPct) incumplidos.push(`consistencia: ${r.consistenciaPct}% (mín ${criterios.consistenciaMinPct}%)`);
  if (r.errorApiPct > criterios.errorApiMaxPct) incumplidos.push(`errores de API: ${r.errorApiPct}% (máx ${criterios.errorApiMaxPct}%)`);
  if (r.latenciaP95Ms > criterios.latenciaP95MaxMs) incumplidos.push(`latencia p95: ${r.latenciaP95Ms} ms (máx ${criterios.latenciaP95MaxMs} ms)`);

  return { ...r, veredicto: { pasa: incumplidos.length === 0, incumplidos } };
}
