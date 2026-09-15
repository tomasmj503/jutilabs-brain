import type { HerramientaLLM } from '../../types/index.js';

/** Arma cfg.linkReservaBase + &arrival=AAAA-MM-DD&nights=N&guests=N. Valida fechas futuras. No confirma reservas — TODO(qwen3-coder-plus). Siempre filtra por ctx.cfg.id (cliente_id). */
export const generarLinkReserva: HerramientaLLM = {
  nombre: 'generar_link_reserva',
  descripcion: 'Arma cfg.linkReservaBase + &arrival=AAAA-MM-DD&nights=N&guests=N. Valida fechas futuras. No confirma reservas',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar() {
    throw new Error('No implementado: generar_link_reserva');
  },
};
