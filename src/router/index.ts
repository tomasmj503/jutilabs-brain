import type { ClienteConfig, ContextoConversacion, DecisionRouter, ReglaRouter, TurnoEntrante } from '../types/index.js';
import { reglaPausado } from './reglas/pausado.js';
import { reglaPidioHumano } from './reglas/pidioHumano.js';
import { reglaFueraDeAlcance } from './reglas/fueraDeAlcance.js';
import { reglaMedia } from './reglas/media.js';
import { reglaFormularioActivo } from './reglas/formularioActivo.js';

/** ORDEN = decisión de negocio. No reordenar sin autorización (ver .clinerules). */
const reglas: ReglaRouter[] = [reglaPausado, reglaMedia, reglaFormularioActivo, reglaPidioHumano, reglaFueraDeAlcance];

export async function rutear(turno: TurnoEntrante, ctx: ContextoConversacion, cfg: ClienteConfig): Promise<DecisionRouter> {
  for (const regla of reglas) {
    const d = await regla.evaluar(turno, ctx, cfg);
    if (d) return d;
  }
  return { tipo: 'llm' };
}
