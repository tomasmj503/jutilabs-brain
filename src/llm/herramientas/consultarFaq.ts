import type { HerramientaLLM } from '../../types/index.js';
import { supabase } from '../../db/supabase.js';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const RELLENO = new Set(['para', 'como', 'cual', 'cuales', 'donde', 'tienen', 'tiene', 'quiero', 'puedo', 'esta', 'estan', 'saber', 'sobre']);
/** Cuenta cuántas palabras de la consulta aparecen en el texto (compara las primeras 5 letras). */
const puntuar = (tokens: string[], texto: string) => tokens.filter((t) => texto.includes(t.slice(0, 5))).length;

/** Busca en faq y politicas del cliente (activo=true) por palabras clave. Siempre filtra por ctx.cfg.id. */
export const consultarFaq: HerramientaLLM<{ consulta?: string }> = {
  nombre: 'consultar_faq',
  descripcion: 'Busca en preguntas frecuentes y políticas del lugar (check-in, cancelaciones, café, ubicación, qué incluye). Escribe la consulta en español, con palabras clave',
  parametros: {
    type: 'object',
    properties: { consulta: { type: 'string', description: 'Palabras clave en español, ej: "cancelación" o "desayuno incluido"' } },
    required: ['consulta'],
  },
  async ejecutar(args, ctx) {
    const tokens = norm(String(args.consulta ?? '')).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !RELLENO.has(t));
    const cid = ctx.cfg.id;
    const [faq, pol] = await Promise.all([
      supabase.from('faq').select('categoria, pregunta_es, respuesta_es, palabras_clave').eq('cliente_id', cid).eq('activo', true),
      supabase.from('politicas').select('tipo, titulo, texto_es, escala_si').eq('cliente_id', cid).eq('activo', true),
    ]);
    const error = faq.error ?? pol.error;
    if (error) throw new Error(`consultar_faq: ${error.message}`);
    const mejores = <T>(filas: T[], puntaje: (x: T) => number) =>
      filas.map((x) => ({ x, n: puntaje(x) })).filter((y) => y.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((y) => y.x);
    const faqs = mejores(faq.data ?? [], (f) => 2 * puntuar(tokens, norm((f.palabras_clave ?? []).join(' '))) + puntuar(tokens, norm(`${f.pregunta_es} ${f.categoria}`)))
      .map((f) => ({ pregunta: f.pregunta_es, respuesta: f.respuesta_es }));
    const politicas = mejores(pol.data ?? [], (p) => 2 * puntuar(tokens, norm(`${p.tipo} ${p.titulo}`)) + puntuar(tokens, norm(p.texto_es)))
      .map((p) => ({ titulo: p.titulo, texto: p.texto_es, pasar_a_persona_si: p.escala_si }));
    if (faqs.length === 0 && politicas.length === 0) {
      return { faq: [], politicas: [], nota: 'No hay información sobre esto. No inventes: avisa que consultarás al equipo y escribe [[NO_SE]].' };
    }
    return { faq: faqs, politicas };
  },
};
