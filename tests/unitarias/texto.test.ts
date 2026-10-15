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

// #17 / V-32 (UNI-IDIOMA): quien escribe en otro idioma (ni español ni inglés) recibe la respuesta en inglés.
describe('detectarIdioma: otros idiomas → inglés', () => {
  it.each([
    ['Bonjour, combien coûte une chambre pour deux ?'],
    ['Guten Tag, wie viel kostet ein Zimmer? Ich mochte bitte reservieren'],
    ['Ciao, quanto costa una camera? Vorrei prenotare, grazie'],
    ['Quanto custa a diária? Quero reservar uma vaga, obrigado'],
  ])('«%s» → en (aunque la conversación venía en español)', (texto) => {
    expect(detectarIdioma(texto, 'es', AMBOS)).toBe('en');
  });
  it('si el cliente no permite inglés, no cambia', () => {
    expect(detectarIdioma('Bonjour, combien coûte une chambre pour deux ?', 'es', ['es'])).toBe('es');
  });
  it('el español y el inglés de siempre no cambian de resultado', () => {
    expect(detectarIdioma('Hola, ¿cuánto cuesta una clase para dos personas?', 'en', AMBOS)).toBe('es');
    expect(detectarIdioma('Do you have a room for two?', 'es', AMBOS)).toBe('en');
  });
  it('una palabra suelta de otro idioma dentro de un texto en español no lo cambia', () => {
    expect(detectarIdioma('Hola, ¿tienen habitación para dos? Merci', 'es', AMBOS)).toBe('es');
  });
});
