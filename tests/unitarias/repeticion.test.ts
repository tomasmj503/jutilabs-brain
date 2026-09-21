import { describe, it, expect } from 'vitest';
import { esRepeticion } from '../../src/ingesta/repeticion.js';
import type { ContextoConversacion } from '../../src/types/index.js';

const conv = (ultimos: ContextoConversacion['ultimosMensajes']): ContextoConversacion => ({
  id: 'c1', clienteId: 'k1', chatwootConversationId: 1, canal: 'whatsapp', idioma: 'es', pais: null,
  estadoBot: 'activo', formularioActivo: null, mensajesSalientesHoy: 0, ultimosMensajes: ultimos,
});
const previo = [
  { rol: 'huesped' as const, contenido: '¿Cuánto cuesta la clase suelta?' },
  { rol: 'bot' as const, contenido: 'La clase suelta cuesta $66.000 🙏' },
];

describe('esRepeticion', () => {
  it('detecta la misma respuesta ante un mensaje distinto', () => {
    expect(esRepeticion(conv(previo), 'La clase suelta cuesta $66.000 🙏', 'asdf')).toBe(true);
  });
  it('permite repetir si el huésped repite su pregunta', () => {
    expect(esRepeticion(conv(previo), 'La clase suelta cuesta $66.000 🙏', '¿Cuánto cuesta la clase suelta?')).toBe(false);
  });
  it('no marca una respuesta distinta', () => {
    expect(esRepeticion(conv(previo), 'El paquete de 4 cuesta $160.000', '¿y el paquete de 4?')).toBe(false);
  });
  it('sin historial no hay repetición', () => {
    expect(esRepeticion(conv([]), 'Hola', 'Hola')).toBe(false);
  });
});
