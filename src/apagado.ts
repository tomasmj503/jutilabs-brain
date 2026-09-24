import { cuantosEnCurso, esperarEnCurso } from './ingesta/enCurso.js';

/**
 * Cuánto esperamos a que terminen los turnos en curso al apagar.
 * Un turno normal tarda 5 a 15 s. El peor caso realista: buffer 4 s + preparar 5 s + modelo principal
 * 25 s + modelo de respaldo 25 s + envío 10 s + notas ≈ 85 s. El candado de la conversación dura 120 s:
 * esperar más que eso no sirve. Por eso 100 s.
 * OJO: `stop_grace_period` del servicio brain en infra/docker-compose.yml DEBE ser mayor (hay una prueba
 * que lo vigila). Si se cambia este número, revisar aquello.
 */
export const TOPE_APAGADO_MS = 100_000;
/** Cuánto esperamos a que el servidor deje de aceptar avisos antes de seguir de todos modos. */
export const TOPE_CERRAR_SERVIDOR_MS = 5_000;

/** Espera a `promesa`, pero no más de `ms` (nunca rechaza). */
async function conLimite(promesa: Promise<unknown>, ms: number, aviso: string): Promise<void> {
  let reloj: NodeJS.Timeout | undefined;
  const limite = new Promise<void>((r) => {
    reloj = setTimeout(r, ms);
  });
  await Promise.race([promesa.catch((e) => console.error(aviso, e instanceof Error ? e.message : e)), limite]);
  clearTimeout(reloj);
}

type Opciones = {
  senal: string;
  cerrarServidor: () => Promise<void>;
  cerrarRedis: () => Promise<void>;
  topeMs?: number;
};

/** Apagado ordenado. Devuelve cuántos turnos quedaron cortados (0 = todo terminó bien). */
export async function apagarOrdenado(op: Opciones): Promise<number> {
  const tope = op.topeMs ?? TOPE_APAGADO_MS;
  console.log(`APAGADO ${op.senal}: dejo de aceptar avisos, turnos en curso=${cuantosEnCurso()}`);

  // 1) Dejar de aceptar avisos nuevos (los que ya respondieron 200 siguen en el registro).
  await conLimite(op.cerrarServidor(), TOPE_CERRAR_SERVIDOR_MS, 'APAGADO: no cerró el servidor:');

  // 2) Esperar a que terminen los turnos, con tope.
  const { pendientes } = await esperarEnCurso(tope);
  if (pendientes > 0) console.error(`APAGADO INCOMPLETO: ${pendientes} turno(s) cortado(s) tras ${tope} ms`);
  else console.log('APAGADO COMPLETO: no quedó ningún turno en curso');

  // 3) Cerrar Redis (si ya no responde, da igual: el proceso termina).
  await conLimite(op.cerrarRedis(), 2_000, 'APAGADO: no cerró Redis:');
  return pendientes;
}
