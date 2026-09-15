import type { ReglaRouter } from '../../types/index.js';

/** TODO(qwen3-coder-plus): ver descripción de la regla en .clinerules y §11.4 de Notion. */
export const reglaPidioHumano: ReglaRouter = {
  nombre: 'pidioHumano',
  async evaluar() {
    throw new Error('No implementado: pidioHumano');
  },
};
