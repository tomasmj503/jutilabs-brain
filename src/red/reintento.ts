/**
 * Reintentos de red con criterio: qué se puede repetir sin riesgo y qué no.
 *
 * Dos políticas:
 *  - 'segura': lecturas y guardados que no hacen daño al repetirse (Supabase, Chatwoot: perfil,
 *    estado, nota privada). Reintenta ante cualquier falla pasajera de red y ante 429/5xx.
 *  - 'solo-si-no-salio': lo que le llega a una persona o cuesta dinero (enviar el WhatsApp).
 *    Solo reintenta cuando el error PRUEBA que la petición nunca salió del servidor
 *    (no se pudo traducir el nombre, conexión rechazada). Nunca reintenta un error de
 *    respuesta (ej. 503) ni un corte a mitad de camino: ahí no se sabe si llegó.
 *
 * Solo sirve con cuerpos de texto (JSON): se vuelven a mandar tal cual en cada intento.
 */

export type Politica = 'segura' | 'solo-si-no-salio';
export type Salida = 'no-salio' | 'quiza-salio';

/** Errores que ocurren ANTES de que la petición salga del servidor. */
const CODIGOS_NO_SALIO = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const ESTADOS_TRANSITORIOS = new Set([429, 500, 502, 503, 504]);

export const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Todos los códigos de error que se puedan leer del error (incluye los de AggregateError). */
export function codigosDeRed(e: unknown): string[] {
  const codigos: string[] = [];
  const tomar = (x: unknown): void => {
    const c = (x as { code?: unknown } | null | undefined)?.code;
    if (typeof c === 'string') codigos.push(c);
  };
  tomar(e);
  const causa = (e as { cause?: unknown } | null | undefined)?.cause;
  tomar(causa);
  const internos = (causa as { errors?: unknown } | null | undefined)?.errors;
  if (Array.isArray(internos)) internos.forEach(tomar);
  return codigos;
}

/** True si parece una falla de red (y no un error de código nuestro). */
export function esFalloDeRed(e: unknown): boolean {
  if (codigosDeRed(e).length > 0) return true;
  const nombre = (e as { name?: unknown } | null | undefined)?.name;
  if (nombre === 'TimeoutError' || nombre === 'AbortError') return true;
  return e instanceof TypeError && /fetch failed/i.test(e.message);
}

/** 'no-salio' solo si TODOS los códigos prueban que la petición nunca salió. Ante la duda: 'quiza-salio'. */
export function clasificarFalloDeRed(e: unknown): Salida {
  const codigos = codigosDeRed(e);
  return codigos.length > 0 && codigos.every((c) => CODIGOS_NO_SALIO.has(c)) ? 'no-salio' : 'quiza-salio';
}

function puedeReintentar(e: unknown, politica: Politica): boolean {
  if (!esFalloDeRed(e)) return false;
  return politica === 'segura' ? true : clasificarFalloDeRed(e) === 'no-salio';
}

function describir(e: unknown): string {
  const codigos = codigosDeRed(e);
  if (codigos.length > 0) return codigos.join('+');
  return (e as { name?: string } | null)?.name ?? 'desconocida';
}

export type OpcionesFetch = {
  nombre: string;
  politica: Politica;
  timeoutMs: number;
  /** Intentos en total (el primero cuenta). Por defecto 3. */
  intentos?: number;
  /** Espera antes del intento 2, 3... Por defecto 400 ms y 1200 ms. */
  esperasMs?: number[];
  /** Solo para pruebas. */
  base?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
};

/** Devuelve un fetch con límite de tiempo por intento y reintentos según la política. */
export function crearFetch(op: OpcionesFetch): typeof fetch {
  const intentos = op.intentos ?? 3;
  const esperas = op.esperasMs ?? [400, 1200];
  const usar: typeof fetch = op.base ?? ((input, init) => fetch(input, init));
  const esperar = op.esperar ?? dormir;

  return async (input, init) => {
    for (let intento = 1; ; intento++) {
      const limite = AbortSignal.timeout(op.timeoutMs);
      const senal = init?.signal ? AbortSignal.any([init.signal, limite]) : limite;
      const proximaEspera = esperas[intento - 1] ?? esperas[esperas.length - 1] ?? 1200;
      try {
        const r = await usar(input, { ...init, signal: senal });
        if (op.politica === 'segura' && ESTADOS_TRANSITORIOS.has(r.status) && intento < intentos) {
          console.warn(`RED REINTENTO ${op.nombre} intento=${intento + 1}/${intentos} causa=HTTP ${r.status}`);
          await r.body?.cancel().catch(() => undefined);
          await esperar(proximaEspera);
          continue;
        }
        return r;
      } catch (e) {
        if (intento >= intentos || init?.signal?.aborted || !puedeReintentar(e, op.politica)) throw e;
        console.warn(`RED REINTENTO ${op.nombre} intento=${intento + 1}/${intentos} causa=${describir(e)}`);
        await esperar(proximaEspera);
      }
    }
  };
}
