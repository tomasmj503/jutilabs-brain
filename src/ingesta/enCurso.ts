/**
 * Registro de los avisos que el cerebro ya aceptó y sigue trabajando (buffer, espera del candado,
 * turno completo). Sirve para que un apagado (docker stop = SIGTERM) espere a que terminen en vez de
 * cortarlos: un turno cortado deja al huésped sin respuesta y su mensaje ya quedó marcado como visto.
 */
const enCurso = new Set<Promise<void>>();

/** Anota un trabajo en curso. Nunca rechaza: quien lo pasa ya maneja sus propios errores. */
export function registrarEnCurso(trabajo: Promise<unknown>): void {
  const seguido: Promise<void> = trabajo
    .then(() => undefined, () => undefined)
    .then(() => {
      enCurso.delete(seguido);
    });
  enCurso.add(seguido);
}

export function cuantosEnCurso(): number {
  return enCurso.size;
}

/** Espera a que terminen todos los trabajos en curso, hasta `topeMs`. Devuelve cuántos quedaron sin terminar. */
export async function esperarEnCurso(topeMs: number): Promise<{ pendientes: number }> {
  const limite = Date.now() + topeMs;
  while (enCurso.size > 0) {
    const restante = limite - Date.now();
    if (restante <= 0) break;
    let reloj: NodeJS.Timeout | undefined;
    const tope = new Promise<void>((r) => {
      reloj = setTimeout(r, restante);
    });
    await Promise.race([Promise.allSettled([...enCurso]), tope]);
    clearTimeout(reloj);
  }
  return { pendientes: enCurso.size };
}
