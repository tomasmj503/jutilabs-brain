import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
const { saludoFijo } = await import('../../src/ingesta/atenderTurno.js');

const cfg = (extra: Record<string, unknown>) => ({ idiomaDefault: 'es', configExtra: extra }) as never;

describe('saludoFijo (#14)', () => {
  it('sin saludo en la base usa el del manual', () => {
    expect(saludoFijo(cfg({}), 'es')).toBe('Hola, me llamo Max, ¿en qué te puedo ayudar?');
  });
  it('el saludo de la base (config_extra.saludo) manda sobre el del manual', () => {
    expect(saludoFijo(cfg({ saludo: { es: 'Hola desde la base' } }), 'es')).toBe('Hola desde la base');
  });
  it('si la base no trae ese idioma, usa el idioma por defecto de la base antes que el del manual', () => {
    expect(saludoFijo(cfg({ saludo: { es: 'Hola desde la base' } }), 'en')).toBe('Hola desde la base');
  });
});
