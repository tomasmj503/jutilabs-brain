import type { HerramientaLLM } from '../../types/index.js';

/** Devuelve tipos de habitación activos con descripción e incluye. NUNCA devuelve precio de hospedaje — TODO(qwen3-coder-plus). Siempre filtra por ctx.cfg.id (cliente_id). */
export const consultarHabitaciones: HerramientaLLM = {
  nombre: 'consultar_habitaciones',
  descripcion: 'Devuelve tipos de habitación activos con descripción e incluye. NUNCA devuelve precio de hospedaje',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar() {
    throw new Error('No implementado: consultar_habitaciones');
  },
};
