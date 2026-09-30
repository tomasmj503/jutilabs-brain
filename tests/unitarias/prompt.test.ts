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
  it('[[NO_SE]] es solo cuando no hay NINGÚN dato; para pedir a una persona se usa la herramienta', () => {
    const p = construirSystemPrompt({ ...cfg, temasQueEscalan: ['india', 'retiros'] } as ClienteConfig, conv);
    expect(p).toContain('Si no tienes NINGÚN dato para responder, escribe al final exactamente [[NO_SE]]');
    expect(p).toContain('NO escribas [[NO_SE]]; lo que falte, dile que lo confirma el equipo');
    expect(p).toContain('llama a la herramienta pasar_a_persona');
    expect(p).toContain('Nunca prometas "voy a pasar tu consulta al equipo" sin llamarla');
    expect(p).toContain('india, retiros');
    expect(p).toContain('NO escribas [[NO_SE]] solo por eso');
    // la regla vieja ("o el tema debe pasar a una persona, escribe [[NO_SE]]") contradecía a la lista de temas
    expect(p).not.toContain('o el tema debe pasar a una persona, escribe');
  });
  it('prohíbe decir que algo es gratis o sin costo si no está en los datos, y da salida a lo que no es del negocio', () => {
    const p = construirSystemPrompt(cfg, conv);
    expect(p).toContain('Nunca digas que algo es gratis, sin costo o está incluido si no aparece en los datos');
    expect(p).toContain('no tiene nada que ver con este negocio');
  });
  it('sin temas que escalan, no agrega esa sección', () => {
    expect(construirSystemPrompt(cfg, conv)).not.toContain('TEMAS QUE PASAN A UNA PERSONA');
  });
});
