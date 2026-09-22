import { describe, it, expect, vi } from 'vitest';
import { debeReactivar } from '../../src/conversacion/estado.js';
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const ahora = new Date('2026-09-21T12:00:00Z');

describe('debeReactivar (pausa de 5 horas)', () => {
  it('no reactiva antes de cumplirse las horas', () => {
    expect(debeReactivar('2026-09-21T08:00:00Z', 5, ahora)).toBe(false);
  });
  it('reactiva justo al cumplirse las horas', () => {
    expect(debeReactivar('2026-09-21T07:00:00Z', 5, ahora)).toBe(true);
  });
  it('reactiva pasadas las horas', () => {
    expect(debeReactivar('2026-09-20T12:00:00Z', 5, ahora)).toBe(true);
  });
  it('sin fecha de pausa se reactiva', () => {
    expect(debeReactivar(null, 5, ahora)).toBe(true);
  });
});
