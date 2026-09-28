import type { ReglaRouter } from '../../types/index.js';

/**
 * El huésped mandó SOLO audio, imagen, video, documento, ubicación u otro archivo (ningún texto en el turno).
 * El bot no puede leerlos: no se manda al modelo (no hay nada que responderle). Si el turno trae texto
 * (ej. una foto con pie de foto, o un audio y luego "hola"), decide el texto y esta regla no actúa.
 */
export const reglaMedia: ReglaRouter = {
  nombre: 'media',
  async evaluar(turno) {
    if (turno.textoAgrupado.trim() !== '') return null;
    const tipos = turno.mensajes.map((m) => m.tipo).filter((t) => t !== 'texto');
    return tipos.length > 0 ? { tipo: 'media', tipos } : null;
  },
};
