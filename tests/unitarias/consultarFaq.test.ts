import { describe, it, expect, vi } from 'vitest';
import type { ClienteConfig, ContextoConversacion } from '../../src/types/index.js';

type Fila = { categoria: string; pregunta_es: string; respuesta_es: string; palabras_clave: string[] };
let faqEnBase: Fila[] = [];

vi.mock('../../src/db/supabase.js', () => ({
  supabase: {
    from: (tabla: string) => {
      const consulta = { eq: () => consulta, then: (ok: (r: unknown) => unknown) => ok({ data: tabla === 'faq' ? faqEnBase : [], error: null }) };
      return { select: () => consulta };
    },
  },
}));

const { consultarFaq } = await import('../../src/llm/herramientas/consultarFaq.js');

// Filas reales de Mandala (2-oct-2026). Con la búsqueda del modelo, la de USD 500 empata en 3 puntos con otras 4 y queda de última.
const queEsIndia: Fila = { categoria: 'india', pregunta_es: '¿Qué es India · El Camino del Alma?', respuesta_es: 'Un peregrinaje espiritual en español, del 13 al 29 de marzo de 2027 (17 días, 16 noches).', palabras_clave: ['india', 'camino del alma', 'peregrinaje', 'rishikesh', 'varanasi', 'taj mahal', 'ganges', 'pilgrimage', '2027'] };
const viajarSolo: Fila = { categoria: 'india', pregunta_es: '¿Puedo viajar solo/a a India? ¿Necesito experiencia en yoga?', respuesta_es: 'Sí, puedes viajar solo/a: la comunidad es parte central de la experiencia.', palabras_clave: ['india', 'solo', 'sola', 'sin experiencia', 'encuentro online', 'charla', 'otro país'] };
const queIncluye: Fila = { categoria: 'india', pregunta_es: '¿Qué incluye y qué no incluye el viaje a India?', respuesta_es: 'Incluye: 16 noches de alojamiento. No incluye: vuelo internacional, visa para India, seguro de viaje.', palabras_clave: ['india', 'incluye', 'incluido', 'visa', 'seguro', 'vuelo', 'comidas'] };
const comoReservo: Fila = { categoria: 'reservas', pregunta_es: '¿Cómo reservo?', respuesta_es: 'Para hospedaje puedes reservar en línea o por aquí mismo.', palabras_clave: ['reservar', 'reserva', 'reservo', 'cupo', 'book', 'reserve'] };
const reservarClase: Fila = { categoria: 'yoga', pregunta_es: '¿Necesito reservar mi clase?', respuesta_es: 'Recomendamos reservar para asegurar tu espacio.', palabras_clave: ['reservar', 'cupo', 'cupos', 'clase', 'reservación', 'reservacion'] };
const cuantoCuesta: Fila = { categoria: 'india', pregunta_es: '¿Cuánto cuesta el viaje a India y cómo se paga?', respuesta_es: 'Prelanzamiento USD 2.590; Early Bird USD 2.790; precio regular USD 2.990. Se reserva con USD 500 y el saldo se organiza antes del viaje.', palabras_clave: ['india', 'usd', 'dólares', 'dolares', 'cuotas', 'depósito', 'deposito', '500'] };

const ctx = { cfg: { id: 'cliente-1' } as ClienteConfig, conv: {} as ContextoConversacion };
const buscar = async (consulta: string) => {
  const r = (await consultarFaq.ejecutar({ consulta }, ctx)) as { faq: Array<{ pregunta: string; respuesta: string }> };
  return r.faq;
};

describe('consultar_faq — empates', () => {
  const empatadas = [viajarSolo, queIncluye, queEsIndia, comoReservo, reservarClase, cuantoCuesta];

  it('"reserva India 2027 anticipo pago": entrega la respuesta con USD 500 aunque 6 preguntas empaten', async () => {
    faqEnBase = empatadas;
    expect((await buscar('reserva India 2027 anticipo pago')).some((f) => f.respuesta.includes('USD 500'))).toBe(true);
  });
  it('lo mismo si la base las devuelve en otro orden (el orden de la base no está garantizado)', async () => {
    faqEnBase = [...empatadas].reverse();
    expect((await buscar('reserva India 2027 anticipo pago')).some((f) => f.respuesta.includes('USD 500'))).toBe(true);
    faqEnBase = [cuantoCuesta, comoReservo, queEsIndia, reservarClase, viajarSolo, queIncluye];
    expect((await buscar('India reserva anticipo pago')).some((f) => f.respuesta.includes('USD 500'))).toBe(true);
  });
  it('una búsqueda precisa ("depósito") sigue poniendo la de USD 500 primero', async () => {
    faqEnBase = empatadas;
    expect((await buscar('India reserva depósito 500'))[0]?.respuesta).toContain('USD 500');
  });
  it('si nadie empata con la tercera, devuelve solo 3 (no se agrega ruido)', async () => {
    faqEnBase = [queEsIndia, viajarSolo, queIncluye, comoReservo];
    expect((await buscar('India 2027 camino del alma')).length).toBe(3);
  });
  it('con muchos empates devuelve como máximo 8', async () => {
    faqEnBase = Array.from({ length: 12 }, (_, i) => ({ ...comoReservo, pregunta_es: `¿Cómo reservo ${i}?` }));
    expect((await buscar('reserva')).length).toBe(8);
  });
  it('con menos de 3 coincidencias devuelve las que haya', async () => {
    faqEnBase = [cuantoCuesta, comoReservo];
    expect((await buscar('depósito')).length).toBe(1);
  });
});
