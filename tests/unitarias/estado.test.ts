import { describe, it, expect, vi, beforeEach } from 'vitest';

const actualizaciones: Array<Record<string, unknown>> = [];
vi.mock('../../src/db/supabase.js', () => {
  const cadena = (cambios: Record<string, unknown>) => {
    actualizaciones.push(cambios);
    const c: { eq: () => typeof c; then: (f: (r: { error: null }) => unknown) => unknown } = {
      eq: () => c,
      then: (f) => Promise.resolve({ error: null }).then(f),
    };
    return c;
  };
  return { supabase: { from: () => ({ update: cadena }) } };
});

const estado = await import('../../src/conversacion/estado.js');

const cfg = { id: 'c1' } as never;

// D-08 / PC-11: el bot NUNCA vuelve a hablar por tiempo. Solo se libera de forma explícita (nota privada "#max").
// Antes este archivo fijaba lo contrario del manual (reactivar a las 5 h y al instante sin fecha).
describe('estado: sin reactivación por tiempo', () => {
  beforeEach(() => { actualizaciones.length = 0; });

  it('el módulo no ofrece ninguna reactivación por tiempo', () => {
    expect(estado).not.toHaveProperty('debeReactivar');
    expect(estado).not.toHaveProperty('aplicarReactivacion');
  });

  it('la liberación explícita (reactivarBot) deja el bot activo y anota cuándo', async () => {
    await estado.reactivarBot(cfg, 7);
    expect(actualizaciones).toHaveLength(1);
    expect(actualizaciones[0]).toMatchObject({ estado_bot: 'activo' });
    expect(typeof actualizaciones[0]?.reactivado_at).toBe('string');
  });

  it('pausar guarda la fecha y el motivo (para el acuse), pero eso no programa ninguna vuelta', async () => {
    await estado.pausarBot(cfg, 7, 'agente_respondio');
    expect(actualizaciones[0]).toMatchObject({ estado_bot: 'pausado', motivo_escalamiento: 'agente_respondio' });
  });
});
