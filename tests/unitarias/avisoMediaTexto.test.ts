import { describe, it, expect } from 'vitest';
import { textoFijo } from '../../src/ingesta/textosFijos.js';
import { pideHumano } from '../../src/router/reglas/pidioHumano.js';

const cfg = { configExtra: {} } as never;

describe('el aviso de audio/imagen/ubicación y la regla pidioHumano', () => {
  it('en español enseña una frase que SÍ activa a una persona', () => {
    const t = textoFijo(cfg, 'mensajeMedia', 'es');
    expect(t).toContain('quiero hablar con una persona');
    expect(pideHumano('quiero hablar con una persona')).toBe(true);
  });
  it('en inglés enseña una frase que SÍ activa a una persona', () => {
    const t = textoFijo(cfg, 'mensajeMedia', 'en');
    expect(t).toContain('I want to talk to a person');
    expect(pideHumano('I want to talk to a person')).toBe(true);
  });
  it('el aviso mismo no contiene una pregunta de sí/no', () => {
    expect(textoFijo(cfg, 'mensajeMedia', 'es')).not.toContain('¿');
    expect(textoFijo(cfg, 'mensajeMedia', 'en')).not.toContain('?');
  });
  it('si Supabase trae su propio texto, gana ese', () => {
    const propio = { configExtra: { mensajeMedia: { es: 'Texto propio' } } } as never;
    expect(textoFijo(propio, 'mensajeMedia', 'es')).toBe('Texto propio');
  });
});
