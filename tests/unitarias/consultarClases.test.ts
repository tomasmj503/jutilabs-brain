import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClienteConfig, ContextoConversacion } from '../../src/types/index.js';

const selects: Record<string, string> = {};
const filasProductos = [{
  nombre: 'Tarifa especial de yoga para huéspedes', precio: 40000, moneda: 'COP', unidad: '1 clase', notas: null,
  descripcion: 'Precio por clase suelta para huéspedes. Si también aplica a los paquetes, lo confirma una persona del equipo.',
}];

vi.mock('../../src/db/supabase.js', () => ({
  supabase: {
    from: (tabla: string) => {
      // La base solo devuelve las columnas que se le piden: así la prueba falla si falta pedir "descripcion".
      const resultado = () => ({
        data: tabla === 'productos' ? filasProductos.map((f) => Object.fromEntries(selects[tabla]!.split(',').map((c) => c.trim()).map((c) => [c, (f as Record<string, unknown>)[c]]))) : [],
        error: null,
      });
      const consulta: Record<string, unknown> = {
        eq: () => consulta, in: () => consulta, or: () => consulta, order: () => consulta,
        then: (ok: (r: unknown) => unknown) => ok(resultado()),
      };
      return { select: (cols: string) => { selects[tabla] = cols; return consulta; } };
    },
  },
}));

const { consultarClases } = await import('../../src/llm/herramientas/consultarClases.js');

describe('consultar_clases — precios', () => {
  beforeEach(() => { for (const k of Object.keys(selects)) delete selects[k]; });

  it('entrega la descripción de cada producto (ej. "si también aplica a los paquetes, lo confirma una persona del equipo")', async () => {
    const ctx = { cfg: { id: 'c1', zonaHoraria: 'America/Bogota' } as ClienteConfig, conv: { idioma: 'es' } as ContextoConversacion };
    const r = (await consultarClases.ejecutar({}, ctx)) as { precios: Array<{ nombre: string; descripcion?: string }> };
    expect(r.precios[0]?.descripcion).toContain('lo confirma una persona del equipo');
  });
});
