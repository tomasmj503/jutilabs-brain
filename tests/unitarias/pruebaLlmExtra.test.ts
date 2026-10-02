import { describe, it, expect } from 'vitest';
import { leerExtra, armarLlmExtra } from '../prueba-llm/extra.js';

describe('leerExtra (--extra)', () => {
  it('sin --extra no hay nada extra', () => {
    expect(leerExtra(undefined)).toEqual({});
  });
  it('lee un objeto JSON', () => {
    expect(leerExtra('{"provider":{"sort":"latency","data_collection":"deny"}}')).toEqual({ provider: { sort: 'latency', data_collection: 'deny' } });
  });
  it('rechaza JSON roto o que no sea un objeto', () => {
    expect(() => leerExtra('{provider')).toThrow(/--extra/);
    expect(() => leerExtra('[1,2]')).toThrow(/--extra/);
    expect(() => leerExtra('"hola"')).toThrow(/--extra/);
    expect(() => leerExtra('null')).toThrow(/--extra/);
  });
});

describe('armarLlmExtra', () => {
  const provider = { provider: { sort: 'latency' } };
  it('razonamiento apagado: manda reasoning y suma lo extra', () => {
    expect(armarLlmExtra('apagado', provider)).toEqual({ reasoning: { enabled: false }, provider: { sort: 'latency' } });
  });
  it('razonamiento normal: solo lo extra', () => {
    expect(armarLlmExtra('normal', provider)).toEqual({ provider: { sort: 'latency' } });
  });
  it('sin extra queda como hoy (solo reasoning, o nada)', () => {
    expect(armarLlmExtra('apagado', {})).toEqual({ reasoning: { enabled: false } });
    expect(armarLlmExtra('normal', {})).toBeUndefined();
  });
  it('si lo extra trae reasoning, manda lo extra', () => {
    expect(armarLlmExtra('apagado', { reasoning: { effort: 'low' } })).toEqual({ reasoning: { effort: 'low' } });
  });
});
