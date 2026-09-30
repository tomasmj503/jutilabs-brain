import { describe, it, expect } from 'vitest';
import {
  CRITERIOS, evaluar, extraerMontos, fechaEsperada, percentil, plano, resumir,
  type Caso, type Corrida, type Ejecucion,
} from '../prueba-llm/evaluar.js';

const caso = (extra: Partial<Caso> = {}): Caso => ({
  id: 'X01', categoria: 'A-resuelve', turnos: ['hola'], esperado: 'responde', herramientas: [], contiene: [], prohibido: [],
  debe_incluir: [], no_debe: [], nota: '', ...extra,
});
const ej = (extra: Partial<Ejecucion> = {}): Ejecucion => ({
  texto: 'Claro, te cuento todo lo que necesitas saber sobre el hostal y las clases que tenemos para ti.', noSeElDato: false, llamadas: [],
  routerEscala: false, sinModelo: false, error: null, latenciaMs: 1000, tokensEntrada: 500, tokensSalida: 80, ...extra,
});
const ctx = { montosPermitidos: new Set([66000, 160000, 2590, 500]), hoy: '2026-09-29' };

describe('plano', () => {
  it('quita tildes, puntos, comas y espacios', () => {
    expect(plano('1:00 p. m.')).toBe('1:00pm');
    expect(plano('$66.000 COP')).toBe('$66000cop');
    expect(plano('Cápsulas Krishna')).toBe('capsulaskrishna');
  });
});

describe('extraerMontos', () => {
  it('entiende los formatos de pesos y dólares', () => {
    expect(extraerMontos('La clase vale $66.000 COP')).toEqual([66000]);
    expect(extraerMontos('Desde USD 2.590 y la reserva es de 500 USD')).toEqual([2590, 500]);
    expect(extraerMontos('el paquete cuesta $460.000.')).toEqual([460000]);
    expect(extraerMontos('USD 2,590')).toEqual([2590]);
  });
  it('no confunde otros números con dinero', () => {
    expect(extraerMontos('Estamos en la Carrera 77A #63-21, a 10 minutos, 13 cápsulas, 6 camas')).toEqual([]);
    expect(extraerMontos('check-in a la 1:00 p. m. del 13 al 29 de marzo')).toEqual([]);
  });
});

describe('fechaEsperada', () => {
  it('toma este año si la fecha aún no pasó y el siguiente si ya pasó', () => {
    expect(fechaEsperada('11-10', '2026-09-29')).toBe('2026-11-10');
    expect(fechaEsperada('03-01', '2026-09-29')).toBe('2027-03-01');
    expect(fechaEsperada('09-29', '2026-09-29')).toBe('2026-09-29');
  });
});

describe('evaluar — escalamiento', () => {
  it('caso "escala": ok si el modelo escribe [[NO_SE]]', () => {
    expect(evaluar(caso({ esperado: 'escala' }), ej({ noSeElDato: true, texto: '' }), ctx).ok).toBe(true);
  });
  it('caso "escala": ok si el router ya lo atrapa', () => {
    expect(evaluar(caso({ esperado: 'escala' }), ej({ routerEscala: true }), ctx).ok).toBe(true);
  });
  it('caso "escala": responder por su cuenta es falla GRAVE', () => {
    const r = evaluar(caso({ esperado: 'escala' }), ej(), ctx);
    expect(r.ok).toBe(false);
    expect(r.graves).toEqual(['no_escalo']);
  });
  it('caso "responde": [[NO_SE]] es falsa escalación (no grave)', () => {
    const r = evaluar(caso(), ej({ noSeElDato: true, texto: '' }), ctx);
    expect(r.fallas).toEqual(['falsa_escalacion']);
    expect(r.graves).toEqual([]);
  });
  it('si escaló con [[NO_SE]] no se juzga el texto (el huésped no lo ve)', () => {
    const r = evaluar(caso({ esperado: 'escala', prohibido: ['8am'] }), ej({ noSeElDato: true, texto: 'abre a las 8am' }), ctx);
    expect(r.ok).toBe(true);
  });
});

describe('evaluar — texto', () => {
  it('detecta un monto inventado', () => {
    const r = evaluar(caso(), ej({ texto: 'El paquete de 12 clases vale $460.000 COP' }), ctx);
    expect(r.graves).toContain('monto');
  });
  it('acepta los montos permitidos', () => {
    expect(evaluar(caso(), ej({ texto: 'La clase vale $66.000 y el paquete de 4, $160.000' }), ctx).ok).toBe(true);
  });
  it('detecta texto prohibido sin importar tildes ni espacios', () => {
    const r = evaluar(caso({ prohibido: ['8:00 a. m.'] }), ej({ texto: 'Abrimos a las 8:00 a.m. todos los días' }), ctx);
    expect(r.graves).toContain('prohibido');
  });
  it('exige al menos una alternativa de cada grupo', () => {
    const c = caso({ contiene: [['1:00pm', '13:00'], ['11:00am', '11:00']] });
    expect(evaluar(c, ej({ texto: 'El check-in es a la 1:00 p. m. y el check-out a las 11:00 a. m.' }), ctx).ok).toBe(true);
    const r = evaluar(c, ej({ texto: 'El check-in es a la 1:00 p. m.' }), ctx);
    expect(r.fallas).toEqual(['contiene']);
  });
  it('exige pregunta cuando el caso lo pide', () => {
    expect(evaluar(caso({ debe_preguntar: true }), ej({ texto: 'Dime tus fechas por favor' }), ctx).fallas).toEqual(['pregunta']);
    expect(evaluar(caso({ debe_preguntar: true }), ej({ texto: '¿Para qué fechas y cuántas personas?' }), ctx).ok).toBe(true);
  });
  it('detecta respuesta en español cuando debía ser inglés', () => {
    const c = caso({ idioma_respuesta: 'en' });
    expect(evaluar(c, ej({ texto: 'Claro, el check-in es a la 1 p. m. y tienes custodia de equipaje.' }), ctx).fallas).toEqual(['idioma']);
    expect(evaluar(c, ej({ texto: 'Sure, check-in is at 1 p.m. and you can leave your luggage with us.' }), ctx).ok).toBe(true);
  });
  it('una respuesta corta sin palabras reconocibles no cuenta como idioma equivocado', () => {
    expect(evaluar(caso(), ej({ texto: 'Aquí tienes tu link: https://reservas.example/?arrival=2026-11-10&nights=3' }), ctx).ok).toBe(true);
    expect(evaluar(caso({ idioma_respuesta: 'en' }), ej({ texto: 'Here you go: https://reservas.example/?arrival=2026-11-10' }), ctx).ok).toBe(true);
    // los parámetros del link (nights, guests) no cuentan como inglés
    expect(evaluar(caso(), ej({ texto: 'Aquí tienes tu link: https://reservas.example/?arrival=2026-11-10&nights=3&guests=2' }), ctx).ok).toBe(true);
  });
  it('un error de la API cuenta como falla y corta lo demás', () => {
    const r = evaluar(caso(), ej({ error: 'timeout', texto: '' }), ctx);
    expect(r.fallas).toEqual(['error_api']);
  });
});

describe('evaluar — herramientas', () => {
  it('basta con usar UNA de las herramientas esperadas', () => {
    const c = caso({ herramientas: ['consultar_clases', 'consultar_faq'] });
    expect(evaluar(c, ej({ llamadas: [{ nombre: 'consultar_faq', args: {}, resultado: {} }] }), ctx).ok).toBe(true);
    expect(evaluar(c, ej({ llamadas: [{ nombre: 'consultar_eventos', args: {}, resultado: {} }] }), ctx).fallas).toEqual(['herramienta']);
  });
  it('verifica los argumentos del link de reserva', () => {
    const c = caso({ esperado: 'link', herramientas: ['generar_link_reserva'], args_link: { mes_dia: '11-10', noches: 3, huespedes: 2 } });
    const llamada = (args: Record<string, unknown>) => ({ nombre: 'generar_link_reserva', args, resultado: { link: 'https://x?arrival=' } });
    expect(evaluar(c, ej({ llamadas: [llamada({ llegada: '2026-11-10', noches: 3, huespedes: 2 })] }), ctx).ok).toBe(true);
    expect(evaluar(c, ej({ llamadas: [llamada({ llegada: '2026-11-10', noches: 4, huespedes: 2 })] }), ctx).fallas).toEqual(['args_link']);
    expect(evaluar(c, ej({ llamadas: [{ nombre: 'generar_link_reserva', args: {}, resultado: { error: 'Fecha inválida' } }] }), ctx).fallas).toContain('args_link');
  });
  it('cuenta herramientas con error y búsquedas vacías (informativo)', () => {
    const r = evaluar(caso(), ej({
      llamadas: [
        { nombre: 'generar_link_reserva', args: {}, resultado: { error: 'x' } },
        { nombre: 'consultar_faq', args: {}, resultado: { faq: [], politicas: [] } },
      ],
    }), ctx);
    expect(r.herramientasConError).toBe(1);
    expect(r.busquedasVacias).toBe(1);
  });
});

describe('resumir', () => {
  const corrida = (id: string, e: Partial<Ejecucion>, c: Partial<Caso> = {}, rep = 0): Corrida => {
    const cs = caso({ id, ...c });
    const x = ej(e);
    return { caso: cs, rep, ej: x, ev: evaluar(cs, x, ctx) };
  };
  it('un modelo perfecto pasa', () => {
    const r = resumir([corrida('A', {}), corrida('A', {}, {}, 1), corrida('B', { noSeElDato: true, texto: '' }, { esperado: 'escala' })]);
    expect(r.veredicto).toEqual({ pasa: true, incumplidos: [] });
    expect(r.aprobadasPct).toBe(100);
    expect(r.consistenciaPct).toBe(100);
  });
  it('un solo monto inventado lo descalifica', () => {
    const r = resumir([corrida('A', { texto: 'Cuesta $999.000' })]);
    expect(r.veredicto.pasa).toBe(false);
    expect(r.veredicto.incumplidos.join(' ')).toContain('montos inventados');
  });
  it('mide consistencia: pasar 2 de 3 repeticiones no cuenta', () => {
    const r = resumir([corrida('A', {}), corrida('A', {}, {}, 1), corrida('A', { noSeElDato: true, texto: '' }, {}, 2)], { ...CRITERIOS, consistenciaMinPct: 90 });
    expect(r.consistenciaPct).toBe(0);
  });
  it('percentil', () => {
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentil([], 95)).toBe(0);
  });
});

describe('preguntas.json', () => {
  it('tiene ids únicos, herramientas reales y args_link con formato MM-DD', async () => {
    const { readFile } = await import('node:fs/promises');
    const set = JSON.parse(await readFile(new URL('../prueba-llm/preguntas.json', import.meta.url), 'utf8')) as { casos: Caso[] };
    const ids = set.casos.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const reales = ['consultar_faq', 'consultar_clases', 'consultar_eventos', 'consultar_habitaciones', 'generar_link_reserva'];
    for (const c of set.casos) {
      expect(c.turnos.length).toBeGreaterThan(0);
      for (const h of c.herramientas) expect(reales).toContain(h);
      if (c.args_link) expect(c.args_link.mes_dia).toMatch(/^\d{2}-\d{2}$/);
    }
  });
});
