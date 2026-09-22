import { describe, it, expect, vi } from 'vitest';
import { leerAviso } from '../../src/ingesta/aviso.js';

vi.spyOn(console, 'log').mockImplementation(() => undefined);

const entrante = {
  event: 'message_created', message_type: 'incoming', id: 501, content: ' hola ',
  sender: { id: 7, type: 'contact', phone_number: '+57 300 123 4567' },
  conversation: { id: 42, meta: { sender: { id: 7 } } }, account: { id: 1 },
};

describe('leerAviso', () => {
  it('lee un mensaje entrante del huésped', () => {
    expect(leerAviso(entrante)).toMatchObject({
      direccion: 'entrante', privado: false, messageId: 501, conversationId: 42, accountId: 1,
      contactId: 7, telefono: '573001234567', remitenteTipo: 'contact', contenido: 'hola',
    });
  });
  it('entiende message_type numérico y notas privadas', () => {
    const a = leerAviso({ ...entrante, message_type: 1, private: true });
    expect(a.direccion).toBe('saliente');
    expect(a.privado).toBe(true);
  });
  it('toma el teléfono de contact_inbox si el remitente no lo trae', () => {
    const conv = { id: 42, contact_inbox: { source_id: '573009998888' } };
    expect(leerAviso({ ...entrante, sender: { id: 7, type: 'contact' }, conversation: conv }).telefono).toBe('573009998888');
  });
  it('no se rompe con campos faltantes', () => {
    expect(leerAviso({})).toMatchObject({
      evento: null, direccion: null, messageId: null, conversationId: null, telefono: null, contenido: '',
    });
  });
  it('no se rompe si el cuerpo no es un objeto', () => {
    expect(leerAviso(null).accountId).toBeNull();
  });
});
