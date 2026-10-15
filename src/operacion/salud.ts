/**
 * Latidos de los trabajadores internos (hoy: el barrido de la bandeja). Cada uno anota que sigue vivo; el endpoint
 * /health/ready (para el monitor externo) falla si un latido envejece más de LATIDO_MAXIMO_MS.
 */
const latidos = new Map<string, number>();

/** Cuánto puede tardar un trabajador en volver a latir antes de considerarlo muerto (PC-25: 3 min). */
export const LATIDO_MAXIMO_MS = 3 * 60_000;

export function registrarLatido(nombre: string, ahoraMs: number = Date.now()): void {
  latidos.set(nombre, ahoraMs);
}

/** Milisegundos desde el último latido, o null si ese trabajador nunca latió (no arrancó en este proceso). */
export function edadDelLatido(nombre: string, ahoraMs: number = Date.now()): number | null {
  const ultimo = latidos.get(nombre);
  return ultimo === undefined ? null : ahoraMs - ultimo;
}

/** Solo para pruebas. */
export function olvidarLatidos(): void {
  latidos.clear();
}
