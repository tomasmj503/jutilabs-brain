import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

import { armarContexto } from '../../src/conversacion/almacen.js';

const fila = {
  id: 'uuid-1',
  cliente_id: 'cli-1',
  chatwoot_conversation_id: 7,
  canal: 'whatsapp',
  idioma: 'en',
  pais: 'US',
  estado_bot: 'pausado',
};

describe('armarContexto', () => {
  it('copia los datos de la conversación', () => {
    expect(armarContexto(fila, [])).toMatchObject({
      id: 'uuid-1',
      clienteId: 'cli-1',
      chatwootConversationId: 7,
      canal: 'whatsapp',
      idioma: 'en',
      pais: 'US',
      estadoBot: 'pausado',
      formularioActivo: null,
      ultimosMensajes: [],
    });
  });

  it('un valor desconocido cae al valor por defecto', () => {
    const ctx = armarContexto({ ...fila, canal: 'x', idioma: 'fr', estado_bot: '???' }, []);
    expect(ctx.canal).toBe('whatsapp');
    expect(ctx.idioma).toBe('es');
    expect(ctx.estadoBot).toBe('activo');
  });

  it('los mensajes conservan el orden y se descartan los vacíos', () => {
    const ctx = armarContexto(fila, [
      { rol: 'huesped', contenido: 'hola' },
      { rol: 'bot', contenido: '   ' },
      { rol: 'bot', contenido: null },
      { rol: 'bot', contenido: '¿te genero el enlace?' },
      { rol: 'huesped', contenido: 'sí' },
    ]);
    expect(ctx.ultimosMensajes).toEqual([
      { rol: 'huesped', contenido: 'hola' },
      { rol: 'bot', contenido: '¿te genero el enlace?' },
      { rol: 'huesped', contenido: 'sí' },
    ]);
  });

  it('se descartan los roles desconocidos', () => {
    const ctx = armarContexto(fila, [
      { rol: 'robot', contenido: 'no debe entrar' },
      { rol: 'agente', contenido: 'te ayudo yo' },
    ]);
    expect(ctx.ultimosMensajes).toEqual([{ rol: 'agente', contenido: 'te ayudo yo' }]);
  });
});
