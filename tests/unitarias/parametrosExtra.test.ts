import { describe, it, expect } from 'vitest';
import { parametrosExtra } from '../../src/llm/parametrosExtra.js';

const cfg = (llmExtra: unknown) => ({ configExtra: { llmExtra } });

describe('parametrosExtra', () => {
  it('devuelve los parámetros del cliente', () => {
    expect(parametrosExtra(cfg({ reasoning: { enabled: false } }))).toEqual({ reasoning: { enabled: false } });
  });
  it('sin configuración, devuelve vacío', () => {
    expect(parametrosExtra({ configExtra: {} })).toEqual({});
  });
  it('ignora lo que no es un objeto plano', () => {
    for (const malo of ['reasoning', 42, true, null, ['a'], undefined]) expect(parametrosExtra(cfg(malo))).toEqual({});
  });
  it('descarta los campos que el cerebro maneja por su cuenta', () => {
    const r = parametrosExtra(cfg({ model: 'otro', messages: [], tools: [], tool_choice: 'none', stream: true, reasoning: { effort: 'none' } }));
    expect(r).toEqual({ reasoning: { effort: 'none' } });
  });
});
