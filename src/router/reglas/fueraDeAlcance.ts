import type { ReglaRouter } from '../../types/index.js';
import { normalizar } from '../texto.js';

/**
 * Temas de alto valor que SIEMPRE deben pasar a una persona (india, voluntariado, etc.),
 * aunque el modelo ya haya dado la información. Viene de cfg.temasQueEscalan (Supabase).
 * El modelo SIGUE respondiendo con la info real (no se bloquea): esta regla solo garantiza
 * que, después, el bot quede pausado y el equipo se entere — sin depender de que el
 * modelo se acuerde de escalar por su cuenta.
 */
export const reglaFueraDeAlcance: ReglaRouter = {
  nombre: 'fueraDeAlcance',
  async evaluar(turno, _ctx, cfg) {
    const texto = normalizar(turno.textoAgrupado);
    const tema = cfg.temasQueEscalan.find((t) => texto.includes(normalizar(t)));
    if (!tema) return null;
    return { tipo: 'escalar', motivo: 'fuera_de_alcance', mensajeAlHuesped: null };
  },
};
