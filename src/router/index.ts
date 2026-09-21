import type { ClienteConfig, ContextoConversacion, DecisionRouter, ReglaRouter, TurnoEntrante } from '../types/index.js';
import { reglaPausado } from './reglas/pausado.js';

/**
 * ORDEN = decisión de negocio. No reordenar sin autorización (ver .clinerules).
 * FALTAN por construir (sus archivos existen en ./reglas pero lanzan error, por eso no están en la lista):
 * media (fotos y audios), formularioActivo, pidioHumano y fueraDeAlcance.
 * Orden previsto al construirlas: pausado → media → formularioActivo → pidioHumano → fueraDeAlcance.
 */
const reglas: ReglaRouter[] = [reglaPausado];

export async function rutear(turno: TurnoEntrante, ctx: ContextoConversacion, cfg: ClienteConfig): Promise<DecisionRouter> {
  for (const regla of reglas) {
    const d = await regla.evaluar(turno, ctx, cfg);
    if (d) return d;
  }
  return { tipo: 'llm' };
}
