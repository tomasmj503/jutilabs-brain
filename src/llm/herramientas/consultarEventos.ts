import type { HerramientaLLM } from '../../types/index.js';
import { supabase } from '../../db/supabase.js';

/** Próximos eventos (fecha >= hoy en la zona horaria del cliente), máximo 10. Siempre filtra por ctx.cfg.id. */
export const consultarEventos: HerramientaLLM = {
  nombre: 'consultar_eventos',
  descripcion: 'Devuelve los próximos eventos del lugar (desde hoy), máximo 10',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar(_args, ctx) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.cfg.zonaHoraria }).format(new Date());
    const { data, error } = await supabase.from('eventos')
      .select('nombre, fecha, hora, descripcion, precio, moneda, link')
      .eq('cliente_id', ctx.cfg.id).eq('activo', true).gte('fecha', hoy)
      .order('fecha').order('hora').limit(10);
    if (error) throw new Error(`consultar_eventos: ${error.message}`);
    const eventos = (data ?? []).map((e) => ({ ...e, hora: e.hora ? String(e.hora).slice(0, 5) : null }));
    if (eventos.length === 0) return { eventos, nota: 'No hay eventos programados por ahora.' };
    return { eventos };
  },
};
