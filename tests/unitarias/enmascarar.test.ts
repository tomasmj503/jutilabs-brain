import { describe, it, expect } from 'vitest';
import { enmascararSensibles, enmascararTelefono } from '../../src/seguridad/enmascarar.js';

// #16 / PC-19 (UNI-PII)
describe('enmascararSensibles', () => {
  it('oculta un número de tarjeta con espacios', () => {
    const t = enmascararSensibles('mi tarjeta es 4111 1111 1111 1111 gracias');
    expect(t).not.toMatch(/4111/);
    expect(t).toContain('gracias');
  });
  it.each([
    ['4111111111111111'], ['4111-1111-1111-1111'], ['3782 822463 10005'], ['6011 0009 9013 9424 123'],
  ])('oculta %s (13 a 19 dígitos)', (numero) => {
    expect(enmascararSensibles(`pago con ${numero}.`)).not.toMatch(/\d{4}/);
  });
  it('no toca números que no son tarjetas: teléfono de 12 dígitos, fechas, cantidades, 12 dígitos seguidos', () => {
    const t = 'llego el 2026-10-27, somos 3 personas, mi cel es 573001234567 y el total es 66.600';
    expect(enmascararSensibles(t)).toBe(t);
  });
  it('oculta claves y contraseñas dichas con su nombre', () => {
    for (const frase of ['mi clave es Abc12345', 'password: hunter2', 'la contraseña = 998877', 'contrasena es x1y2', 'el pin 4321', 'cvv 123']) {
      const t = enmascararSensibles(frase);
      expect(t, frase).not.toMatch(/Abc12345|hunter2|998877|x1y2|4321|\b123\b/);
    }
  });
  it('no destroza preguntas normales sobre «clave» o «pin»', () => {
    for (const frase of ['¿cuál es la clave del wifi?', 'ando haciendo pin en mapas', 'quiero la clave del candado']) {
      expect(enmascararSensibles(frase)).toBe(frase);
    }
  });
  it('es idempotente', () => {
    const una = enmascararSensibles('tarjeta 4111 1111 1111 1111 y clave es 12ab');
    expect(enmascararSensibles(una)).toBe(una);
  });
});

describe('enmascararTelefono', () => {
  it('deja solo los últimos 4 dígitos', () => {
    expect(enmascararTelefono('573001234567')).toBe('***4567');
  });
  it('null y textos cortos no revelan nada', () => {
    expect(enmascararTelefono(null)).toBe('null');
    expect(enmascararTelefono('12')).toBe('***');
  });
});
