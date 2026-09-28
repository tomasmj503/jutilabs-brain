import type { ClienteConfig, ContextoConversacion, DecisionRouter, ReglaRouter, TurnoEntrante } from '../types/index.js';
import { reglaPausado } from './reglas/pausado.js';
import { reglaMedia } from './reglas/media.js';
import { reglaPidioHumano } from './reglas/pidioHumano.js';
import { reglaFueraDeAlcance } from './reglas/fueraDeAlcance.js';

/**
 * ORDEN = decisión de negocio. No reordenar sin autorización (ver .clinerules).
 * FALTAN por construir (sus archivos existen en ./reglas pero lanzan error, por eso no están en la lista):
 * formularioActivo (media y pidioHumano ya están construidas).
 * Orden previsto al construirlas: pausado → media → formularioActivo → fueraDeAlcance.
 */
const reglas: ReglaRouter[] = [reglaPausado, reglaMedia, reglaPidioHumano, reglaFueraDeAlcance];

export async function rutear(turno: TurnoEntrante, ctx: ContextoConversacion, cfg: ClienteConfig): Promise<DecisionRouter> {
  for (const regla of reglas) {
    const d = await regla.evaluar(turno, ctx, cfg);
    if (d) return d;
  }
  return { tipo: 'llm' };
}
