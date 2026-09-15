import type { HerramientaLLM } from '../../types/index.js';

/** Busca en faq del cliente (activo=true) por palabras clave/categoría, devuelve respuesta en el idioma pedido — TODO(qwen3-coder-plus). Siempre filtra por ctx.cfg.id (cliente_id). */
export const consultarFaq: HerramientaLLM = {
  nombre: 'consultar_faq',
  descripcion: 'Busca en faq del cliente (activo=true) por palabras clave/categoría, devuelve respuesta en el idioma pedido',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar() {
    throw new Error('No implementado: consultar_faq');
  },
};
