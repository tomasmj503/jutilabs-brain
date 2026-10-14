import { describe, it, expect, vi } from 'vitest';

// #22 / V-36 (UNI-HISTORIAL): los mensajes de una PERSONA del equipo entran al historial del modelo con el prefijo
// «[Equipo]» y como mensaje de usuario; antes entraban como `assistant`, es decir, como si los hubiera dicho el bot.
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
const { armarMensajes } = await import('../../src/ingesta/atenderTurno.js');

const cfg = { nombreBot: 'Max', promptBase: '', idiomas: ['es'], temasQueEscalan: [], zonaHoraria: 'America/Bogota', configExtra: {} } as never;

describe('armarMensajes: historial', () => {
  const conv = {
    idioma: 'es',
    ultimosMensajes: [
      { rol: 'huesped', contenido: '¿Tienen cupo el sábado?' },
      { rol: 'bot', contenido: 'Sí, hay cupo.' },
      { rol: 'agente', contenido: 'Hola, soy Andrea. Te confirmo la hora.' },
      { rol: 'sistema', contenido: 'nota interna' },
    ],
  } as never;

  it('huésped → user; bot → assistant; persona del equipo → user con «[Equipo]»; sistema se omite', () => {
    const m = armarMensajes(cfg, conv, 'gracias');
    const historial = m.slice(1, -1);
    expect(historial).toEqual([
      { rol: 'user', contenido: '¿Tienen cupo el sábado?' },
      { rol: 'assistant', contenido: 'Sí, hay cupo.' },
      { rol: 'user', contenido: '[Equipo] Hola, soy Andrea. Te confirmo la hora.' },
    ]);
    expect(m.at(-1)).toEqual({ rol: 'user', contenido: 'gracias' });
  });

  it('nada del equipo queda como assistant', () => {
    const m = armarMensajes(cfg, conv, 'gracias');
    expect(m.filter((x) => x.rol === 'assistant').map((x) => x.contenido)).toEqual(['Sí, hay cupo.']);
  });
});
