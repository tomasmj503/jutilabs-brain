import type { HerramientaLLM } from '../../types/index.js';
import { supabase } from '../../db/supabase.js';

/** Tipos de habitación activos con descripción e incluye. NUNCA devuelve precio de hospedaje. Siempre filtra por ctx.cfg.id. */
export const consultarHabitaciones: HerramientaLLM<{ tipo?: string }> = {
  nombre: 'consultar_habitaciones',
  descripcion: 'Devuelve los tipos de habitación (privadas y compartidas) con descripción, capacidad y qué incluyen. No incluye precios',
  parametros: {
    type: 'object',
    properties: { tipo: { type: 'string', enum: ['privada', 'compartida'], description: 'Opcional: filtra por tipo' } },
    required: [],
  },
  async ejecutar(args, ctx) {
    let q = supabase.from('habitaciones')
      .select('nombre, tipo, descripcion, capacidad, incluye, ideal_para, respuesta_modelo')
      .eq('cliente_id', ctx.cfg.id).eq('activo', true);
    if (args.tipo === 'privada' || args.tipo === 'compartida') q = q.eq('tipo', args.tipo);
    const { data, error } = await q.order('orden');
    if (error) throw new Error(`consultar_habitaciones: ${error.message}`);
    const idioma = ctx.conv.idioma;
    return {
      habitaciones: (data ?? []).map((h) => ({
        nombre: h.nombre, tipo: h.tipo, capacidad: h.capacidad, incluye: h.incluye, ideal_para: h.ideal_para,
        texto: h.respuesta_modelo?.[idioma] ?? h.respuesta_modelo?.es ?? h.descripcion,
      })),
      nota: 'Aquí no hay precios. Para precio o disponibilidad, da el link de reserva.',
    };
  },
};
