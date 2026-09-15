import type { HerramientaLLM } from '../../types/index.js';

/** Devuelve solo eventos futuros (fecha >= hoy en la zona horaria del cliente), máximo 10 — TODO(qwen3-coder-plus). Siempre filtra por ctx.cfg.id (cliente_id). */
export const consultarEventos: HerramientaLLM = {
  nombre: 'consultar_eventos',
  descripcion: 'Devuelve solo eventos futuros (fecha >= hoy en la zona horaria del cliente), máximo 10',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar() {
    throw new Error('No implementado: consultar_eventos');
  },
};
