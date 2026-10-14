import type { ReglaRouter } from '../../types/index.js';
import { normalizar } from '../texto.js';

/**
 * Temas de la lista del cliente (cfg.temasQueEscalan) que AVISAN al equipo. El bot SIGUE atendiendo: esta regla
 * solo garantiza que el equipo se entere, sin depender de que el modelo se acuerde, y NO pausa (D-09 / PC-12).
 * Comparación por PALABRA COMPLETA sobre el texto normalizado: «Indiana» o «informaciones» no son «india» ni
 * «formación». Un tema de varias palabras ("retiro de yoga") debe aparecer completo y en orden.
 */
export function mencionaTema(textoNormalizado: string, tema: string): boolean {
  const t = normalizar(tema);
  if (t === '') return false;
  return ` ${textoNormalizado} `.includes(` ${t} `);
}

export const reglaFueraDeAlcance: ReglaRouter = {
  nombre: 'fueraDeAlcance',
  async evaluar(turno, _ctx, cfg) {
    const texto = normalizar(turno.textoAgrupado);
    const tema = cfg.temasQueEscalan.find((t) => mencionaTema(texto, t));
    if (!tema) return null;
    return { tipo: 'escalar', motivo: 'fuera_de_alcance', mensajeAlHuesped: null, tema: normalizar(tema) };
  },
};
