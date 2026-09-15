import type { ClienteConfig, ContextoConversacion, EstadoFormulario, FormularioDef, ResultadoFormulario } from '../types/index.js';

/**
 * Motor de formularios por configuración (tabla formularios). Un solo código, N configuraciones.
 * Avanza un paso por turno; valida por tipo de campo; al completar inserta en leads y devuelve mensaje de cierre.
 * El aviso al equipo lo dispara src/escalamiento (no aquí).
 * TODO(qwen3-coder-plus).
 */
export async function avanzarFormulario(
  _def: FormularioDef,
  _estado: EstadoFormulario,
  _respuestaHuesped: string,
  _ctx: { cfg: ClienteConfig; conv: ContextoConversacion },
): Promise<ResultadoFormulario> {
  throw new Error('No implementado');
}
