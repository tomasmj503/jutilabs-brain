import { describe, it, expect } from 'vitest';
import { construirSystemPrompt } from '../../src/llm/prompt.js';
import type { ClienteConfig, ContextoConversacion } from '../../src/types/index.js';

const cfg = {
  nombreBot: 'Mandala Bot', idiomas: ['es', 'en'], zonaHoraria: 'America/Bogota',
  promptBase: 'Eres el asistente de Mandala.', temasQueEscalan: [],
} as unknown as ClienteConfig;
const conv = { idioma: 'es' } as ContextoConversacion;

describe('construirSystemPrompt', () => {
  it('sin saludo, no agrega la instrucción de "no des datos"', () => {
    expect(construirSystemPrompt(cfg, conv)).not.toContain('El huésped solo saludó');
  });
  it('con saludo, prohíbe dar datos aunque el modelo los sepa', () => {
    const p = construirSystemPrompt(cfg, conv, true);
    expect(p).toContain('El huésped solo saludó');
    expect(p).toContain('No des precios, horarios ni ningún otro dato');
  });
});
