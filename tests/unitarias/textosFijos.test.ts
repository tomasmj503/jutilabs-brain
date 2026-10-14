import { describe, it, expect } from 'vitest';
import { textoFijo } from '../../src/ingesta/textosFijos.js';
import type { ClienteConfig } from '../../src/types/index.js';

const cfg = (extra: Record<string, unknown>) => ({ configExtra: extra }) as unknown as ClienteConfig;

describe('textoFijo', () => {
  it('usa el texto de Supabase si existe', () => {
    const c = cfg({ mensajeAcuse: { es: 'Texto propio' } });
    expect(textoFijo(c, 'mensajeAcuse', 'es')).toBe('Texto propio');
  });
  it('sin configuración usa el texto por defecto en español', () => {
    expect(textoFijo(cfg({}), 'mensajeNoEntendi', 'es')).toContain('No te entendí');
  });
  it('sin configuración usa el texto por defecto en inglés', () => {
    expect(textoFijo(cfg({}), 'mensajeAcuse', 'en')).toContain('shared your request');
  });
  it('ignora textos vacíos', () => {
    expect(textoFijo(cfg({ mensajeAcuse: { es: '  ' } }), 'mensajeAcuse', 'es')).toContain('Ya compartí tu solicitud');
  });
  it('el mensaje de "lo paso al equipo" existe en español e inglés', () => {
    expect(textoFijo(cfg({}), 'mensajeNoSeElDato', 'es')).toContain('información correcta');
    expect(textoFijo(cfg({}), 'mensajeNoSeElDato', 'en')).toContain('right information');
  });
});

// #14 (UNI-TEXTOS): textos por defecto del manual «Max — Manual final del bot de Mandala» (son código, no datos de la base).
describe('textos por defecto del manual (#14)', () => {
  it('pase a persona: «Ya compartí tu solicitud con el equipo.» (el acuse y el aviso de «pidió humano»)', () => {
    expect(textoFijo(cfg({}), 'mensajeHumano', 'es')).toBe('Ya compartí tu solicitud con el equipo.');
    expect(textoFijo(cfg({}), 'mensajeAcuse', 'es')).toBe('Ya compartí tu solicitud con el equipo.');
  });
  it('sin promesas de tiempo en ningún texto de pase a persona (es ni en)', () => {
    const PROMESA = /en cuanto|cuando puedan|pronto|minutos|horas|as soon as|shortly|within/i;
    for (const clave of ['mensajeHumano', 'mensajeAcuse', 'mensajeNoSeElDato'] as const) {
      for (const idioma of ['es', 'en']) expect(textoFijo(cfg({}), clave, idioma)).not.toMatch(PROMESA);
    }
  });
  it('saludo por defecto: «Hola, me llamo Max, ¿en qué te puedo ayudar?»', () => {
    expect(textoFijo(cfg({}), 'saludo', 'es')).toBe('Hola, me llamo Max, ¿en qué te puedo ayudar?');
    expect(textoFijo(cfg({}), 'saludo', 'en')).toContain('Max');
  });
  it('el mensaje de escalamiento de la base (mensaje_escalamiento) manda sobre el defecto del pase a persona', () => {
    const c = cfg({ mensajeEscalamiento: { es: 'Texto de la base', en: 'Base text' } });
    expect(textoFijo(c, 'mensajeHumano', 'es')).toBe('Texto de la base');
    expect(textoFijo(c, 'mensajeHumano', 'en')).toBe('Base text');
  });
  it('mensajeHumano propio en config_extra le gana a mensaje_escalamiento', () => {
    const c = cfg({ mensajeHumano: { es: 'Propio' }, mensajeEscalamiento: { es: 'De la base' } });
    expect(textoFijo(c, 'mensajeHumano', 'es')).toBe('Propio');
  });
  it('mensaje_escalamiento vacío ({} es el valor por defecto de la columna) cae al texto del manual', () => {
    expect(textoFijo(cfg({ mensajeEscalamiento: {} }), 'mensajeHumano', 'es')).toBe('Ya compartí tu solicitud con el equipo.');
  });
});
