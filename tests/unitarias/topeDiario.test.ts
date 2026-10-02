import { describe, it, expect, vi, beforeEach } from 'vitest';

let resultado: { count: number | null; error: { message: string } | null } = { count: 0, error: null };
const llamadas: unknown[][] = [];
const cadena: Record<string, (...a: unknown[]) => unknown> = {};
cadena.select = (...a) => { llamadas.push(['select', ...a]); return cadena; };
cadena.eq = (...a) => { llamadas.push(['eq', ...a]); return cadena; };
cadena.gte = (...a) => { llamadas.push(['gte', ...a]); return Promise.resolve(resultado); };
vi.mock('../../src/db/supabase.js', () => ({
  supabase: { from: (t: string) => { llamadas.push(['from', t]); return cadena; } },
}));

const { inicioDelDia, llegoAlTope } = await import('../../src/conversacion/topeDiario.js');
const { causaDelEscalamiento } = await import('../../src/salida/causaEscalamiento.js');

const cfg = { zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40 } as never;
const ahora = new Date('2026-10-01T04:30:00Z'); // 23:30 del 30-sep en Bogotá

describe('inicioDelDia', () => {
  it('a las 23:30 de Bogotá, el día empezó a la medianoche de Bogotá', () => {
    expect(inicioDelDia('America/Bogota', ahora).toISOString()).toBe('2026-09-30T05:00:00.000Z');
  });
  it('pasada la medianoche de Bogotá, cuenta el día nuevo', () => {
    const d = new Date('2026-10-01T05:30:00Z');
    expect(inicioDelDia('America/Bogota', d).toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });
  it('sirve para otras zonas (Madrid en verano)', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    expect(inicioDelDia('Europe/Madrid', d).toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });
});

describe('llegoAlTope', () => {
  beforeEach(() => {
    llamadas.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  it('cuenta solo los mensajes del bot de esa conversación desde la medianoche local', async () => {
    resultado = { count: 3, error: null };
    await llegoAlTope(cfg, 'conv1', ahora);
    expect(llamadas).toContainEqual(['from', 'mensajes']);
    expect(llamadas).toContainEqual(['eq', 'conversacion_id', 'conv1']);
    expect(llamadas).toContainEqual(['eq', 'rol', 'bot']);
    expect(llamadas).toContainEqual(['gte', 'created_at', '2026-09-30T05:00:00.000Z']);
  });
  it('39 de 40: todavía responde', async () => {
    resultado = { count: 39, error: null };
    expect(await llegoAlTope(cfg, 'conv1', ahora)).toBe(false);
  });
  it('40 de 40: llegó al tope', async () => {
    resultado = { count: 40, error: null };
    expect(await llegoAlTope(cfg, 'conv1', ahora)).toBe(true);
  });
  it('si no se puede contar, no frena y lo deja en el log', async () => {
    resultado = { count: null, error: { message: 'red caída' } };
    expect(await llegoAlTope(cfg, 'conv1', ahora)).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('causaDelEscalamiento', () => {
  it('el tope tiene su propia causa (no "no tenía el dato")', () => {
    expect(causaDelEscalamiento('limite_mensajes')).toContain('tope diario');
  });
  it('las causas de antes no cambian', () => {
    expect(causaDelEscalamiento('error_interno')).toBe('falla técnica del bot (no fue falta de dato)');
    expect(causaDelEscalamiento('pidio_humano')).toBe('el huésped pidió hablar con una persona');
    expect(causaDelEscalamiento('no_se_el_dato')).toBe('no tenía el dato para responder');
  });
});
