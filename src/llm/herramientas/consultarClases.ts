import type { HerramientaLLM } from '../../types/index.js';
import { supabase } from '../../db/supabase.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Programación regular de clases y precios activos (categoria clase/paquete). Siempre filtra por ctx.cfg.id. */
export const consultarClases: HerramientaLLM = {
  nombre: 'consultar_clases',
  descripcion: 'Devuelve la programación regular de clases (día, hora, frecuencia) y los precios activos de clases y paquetes',
  parametros: { type: 'object', properties: {}, required: [] },
  async ejecutar(_args, ctx) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.cfg.zonaHoraria }).format(new Date());
    const cid = ctx.cfg.id;
    const [clases, precios] = await Promise.all([
      supabase.from('clases')
        .select('nombre, dia_semana, hora, duracion_min, frecuencia, nivel, descripcion, respuesta_modelo')
        .eq('cliente_id', cid).eq('activo', true).order('dia_semana').order('hora'),
      supabase.from('productos')
        .select('nombre, precio, moneda, unidad, notas')
        .eq('cliente_id', cid).eq('activo', true).in('categoria', ['clase', 'paquete'])
        .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`).order('precio'),
    ]);
    const error = clases.error ?? precios.error;
    if (error) throw new Error(`consultar_clases: ${error.message}`);
    const idioma = ctx.conv.idioma;
    return {
      clases: (clases.data ?? []).map((c) => ({
        nombre: c.nombre, dia: DIAS[c.dia_semana], hora: String(c.hora).slice(0, 5),
        duracion_min: c.duracion_min, frecuencia: c.frecuencia, nivel: c.nivel,
        texto: c.respuesta_modelo?.[idioma] ?? c.respuesta_modelo?.es ?? c.descripcion,
      })),
      precios: precios.data ?? [],
    };
  },
};
