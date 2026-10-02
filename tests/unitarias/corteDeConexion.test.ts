import { describe, it, expect } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, BadRequestError, InternalServerError, RateLimitError } from 'openai';
import { esCorteDeConexion } from '../../src/llm/corteDeConexion.js';

// Con los errores REALES del SDK de OpenAI (sin simulador), para que un cambio de versión no rompa la detección.
describe('esCorteDeConexion', () => {
  it('un corte de conexión (ECONNRESET, SSL cortado) sin código HTTP sí', () => {
    expect(esCorteDeConexion(new APIConnectionError({ message: 'Connection error.', cause: new Error('read ECONNRESET') }))).toBe(true);
  });
  it('el tiempo agotado (25 s) NO: ya esperó todo', () => {
    expect(esCorteDeConexion(new APIConnectionTimeoutError())).toBe(false);
  });
  it('los errores con código HTTP NO (400, 429, 500)', () => {
    expect(esCorteDeConexion(BadRequestError.generate(400, { message: 'mala' }, 'mala', {}))).toBe(false);
    expect(esCorteDeConexion(RateLimitError.generate(429, { message: 'lento' }, 'lento', {}))).toBe(false);
    expect(esCorteDeConexion(InternalServerError.generate(500, { message: 'caído' }, 'caído', {}))).toBe(false);
  });
  it('un Error cualquiera, null o texto NO', () => {
    expect(esCorteDeConexion(new Error('El modelo devolvió texto vacío'))).toBe(false);
    expect(esCorteDeConexion(null)).toBe(false);
    expect(esCorteDeConexion('Connection error.')).toBe(false);
  });
});
