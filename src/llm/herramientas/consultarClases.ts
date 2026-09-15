import type { HerramientaLLM } from '../../types/index.js';

/** Devuelve la programación regular de clases (tabla clases) y precios activos (productos.categoria in clase,paquete) — TODO(qwen3-coder-plus). Siempre filtra por ctx.cfg.id (cliente_id). */
export const consultarClases: HerramientaLLM = {
  nombre: 'consultar_clases',
  descripcion: 'Devuelve la programación regular de clases (tabla clases) y precios activos (productos.categoria in clase,paquete)',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar() {
    throw new Error('No implementado: consultar_clases');
  },
};
