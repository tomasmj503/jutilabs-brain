import { describe, it, expect, vi } from 'vitest';
// El índice de herramientas importa las que leen de Supabase: se apaga la conexión, esta prueba solo mira la lista.
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

import { pasarAPersona, HERRAMIENTA_PASAR_A_PERSONA } from '../../src/llm/herramientas/pasarAPersona.js';
const { herramientas } = await import('../../src/llm/herramientas/index.js');
import { motivoParaAvisarAlEquipo } from '../../src/ingesta/avisoDeEquipo.js';
import type { ClienteConfig, ContextoConversacion } from '../../src/types/index.js';

describe('herramienta pasar_a_persona', () => {
  it('está registrada junto a las demás herramientas y con su nombre estable', () => {
    expect(HERRAMIENTA_PASAR_A_PERSONA).toBe('pasar_a_persona');
    expect(herramientas.map((h) => h.nombre)).toContain('pasar_a_persona');
    expect(new Set(herramientas.map((h) => h.nombre)).size).toBe(herramientas.length);
  });
  it('no necesita argumentos y solo deja constancia (no manda nada por sí sola)', async () => {
    const r = await pasarAPersona.ejecutar({}, { cfg: {} as ClienteConfig, conv: {} as ContextoConversacion });
    expect(r).toMatchObject({ ok: true });
    expect(pasarAPersona.parametros.required).toEqual([]);
  });
});

describe('motivoParaAvisarAlEquipo', () => {
  it('sin tema de alto valor y sin la herramienta: no se avisa', () => {
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq'])).toBeNull();
  });
  it('si el modelo llamó a pasar_a_persona: se avisa (fuera_de_alcance, sin tocar la base de datos)', () => {
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq', 'pasar_a_persona'])).toBe('fuera_de_alcance');
  });
  it('si el router ya detectó un tema, ese motivo manda (no se avisa dos veces)', () => {
    expect(motivoParaAvisarAlEquipo('fuera_de_alcance', ['pasar_a_persona'])).toBe('fuera_de_alcance');
    expect(motivoParaAvisarAlEquipo('pidio_humano', [])).toBe('pidio_humano');
  });
});
