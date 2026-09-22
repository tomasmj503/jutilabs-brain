import { describe, it, expect } from 'vitest';
import { normalizar, esSoloSaludo, detectarIdioma } from '../../src/router/texto.js';

const AMBOS = ['es', 'en'] as ('es' | 'en')[];

describe('normalizar', () => {
  it('quita tildes, signos y mayúsculas', () => {
    expect(normalizar('¡Sí, Buenas Tardes!')).toBe('si buenas tardes');
  });
});

describe('esSoloSaludo', () => {
  it('acepta saludos simples', () => {
    for (const t of ['Hola!', '¡Buenas tardes!', 'Hello', 'hey']) expect(esSoloSaludo(t)).toBe(true);
  });
  it('rechaza un saludo con pregunta y las respuestas cortas', () => {
    for (const t of ['Hola, ¿cuánto cuesta una clase?', 'sí', 'ok']) expect(esSoloSaludo(t)).toBe(false);
  });
});

describe('detectarIdioma', () => {
  it('detecta inglés', () => {
    expect(detectarIdioma('How much is a class?', 'es', AMBOS)).toBe('en');
  });
  it('detecta español', () => {
    expect(detectarIdioma('Hola, ¿cuánto cuesta una clase?', 'en', AMBOS)).toBe('es');
  });
  it('sin señales o con empate mantiene el idioma actual', () => {
    expect(detectarIdioma('ok', 'en', AMBOS)).toBe('en');
    expect(detectarIdioma('sí', 'es', AMBOS)).toBe('es');
    expect(detectarIdioma('hola hello', 'en', AMBOS)).toBe('en');
  });
  it('no cambia a un idioma que el cliente no permite', () => {
    expect(detectarIdioma('How much is a class?', 'es', ['es'])).toBe('es');
  });
});
