import type { MotivoEscalamiento } from '../types/index.js';
import { HERRAMIENTA_PASAR_A_PERSONA } from '../llm/herramientas/pasarAPersona.js';

/**
 * ¿Hay que avisar al equipo y pausar el bot DESPUÉS de enviar la respuesta del modelo?
 * Sí si el router detectó un tema de alto valor (ese motivo manda, para no avisar dos veces) o si el propio modelo
 * llamó a la herramienta pasar_a_persona. Reutiliza el motivo 'fuera_de_alcance' para no tocar la base de datos.
 */
export function motivoParaAvisarAlEquipo(
  temaAltoValor: MotivoEscalamiento | null, herramientasUsadas: readonly string[],
): MotivoEscalamiento | null {
  if (temaAltoValor) return temaAltoValor;
  return herramientasUsadas.includes(HERRAMIENTA_PASAR_A_PERSONA) ? 'fuera_de_alcance' : null;
}
