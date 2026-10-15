import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const { armarMensajes } = await import('../../src/ingesta/atenderTurno.js');

describe('PII en el historial que ve el modelo', () => {
  it('va enmascarado aunque el mensaje viejo se haya guardado antes de este arreglo (#16)', () => {
    const conv = { idioma: 'es', ultimosMensajes: [{ rol: 'huesped', contenido: 'tarjeta 4111 1111 1111 1111' }] } as never;
    const cfg = { nombreBot: 'Max', promptBase: '', idiomas: ['es'], temasQueEscalan: [], zonaHoraria: 'America/Bogota', configExtra: {} } as never;
    expect(JSON.stringify(armarMensajes(cfg, conv, 'hola'))).not.toMatch(/4111/);
  });
});
