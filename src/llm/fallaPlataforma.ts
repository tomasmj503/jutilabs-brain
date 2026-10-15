/**
 * Una falla de PLATAFORMA del proveedor del modelo no es culpa de la conversación (PC-21 / V-10 / V-22):
 *   400  petición rechazada (p. ej. un parámetro que el modelo no soporta, como tool_choice: required),
 *   401  llave inválida,
 *   402  sin saldo o tope de gasto alcanzado.
 * Pasa igual con TODOS los huéspedes: reintentar solo gasta tiempo y pausar cada conversación es peor que el problema.
 */
export const ESTADOS_DE_PLATAFORMA: readonly number[] = [400, 401, 402];

export function estadoHttp(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

export function esFallaDePlataforma(e: unknown): boolean {
  const s = estadoHttp(e);
  return s !== undefined && ESTADOS_DE_PLATAFORMA.includes(s);
}

export function explicarFallaDePlataforma(status: number): string {
  if (status === 402) return 'sin saldo o tope de gasto alcanzado en el proveedor del modelo';
  if (status === 401) return 'llave del proveedor del modelo inválida o revocada';
  return 'el proveedor rechazó la petición (por ejemplo, un parámetro que el modelo no soporta)';
}
