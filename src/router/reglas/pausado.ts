import type { ReglaRouter } from '../../types/index.js';

/** Bot pausado (escaló a una persona o una persona respondió): no contesta hasta que se reactive. */
export const reglaPausado: ReglaRouter = {
  nombre: 'pausado',
  async evaluar(_turno, ctx) {
    return ctx.estadoBot === 'pausado' ? { tipo: 'ignorar', motivo: 'bot_pausado' } : null;
  },
};
