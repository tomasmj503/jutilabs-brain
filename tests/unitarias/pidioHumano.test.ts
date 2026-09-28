import { describe, it, expect } from 'vitest';
import { pideHumano, reglaPidioHumano } from '../../src/router/reglas/pidioHumano.js';
import { rutear } from '../../src/router/index.js';
import { detectarIdioma } from '../../src/router/texto.js';

const SI = [
  'quiero hablar con una persona', 'Necesito hablar con alguien', '¿Puedo hablar con un asesor?',
  'pásame con el equipo', 'pásenme con alguien por favor', 'me pueden pasar con una persona',
  'quiero hablar directamente con un humano', 'me comunican con recepcionista', 'necesito un humano',
  'prefiero una persona real', 'quiero un asesor', 'que me atienda una persona', 'que me llame alguien',
  'no quiero hablar con un bot', 'no quiero seguir hablando con un robot', 'Humano', 'un asesor por favor',
  'persona real', 'hablar con el dueño', 'quiero hablar con alguien sobre India',
  'can I speak to someone', 'I want to talk to a human', "I'd like to speak to the manager",
  'connect me with a real person', 'I want a human', 'could I get a human please',
  "I don't want to talk to a bot", 'human please', 'a real person',
];
const NO = [
  'hola', '¿a qué hora abre la recepción?', '¿eres un bot?', 'somos 3 personas', 'una persona',
  'quiero reservar para dos personas', 'quiero agregar una persona más a la reserva',
  '¿cuántas personas caben en el dormitorio?', 'hay alguien en recepción de noche?', 'cuánto cuesta la clase suelta',
  'tengo un amigo que habla con la persona de la reserva', 'quiero una habitación privada', 'no hay agua caliente',
  'necesito información de habitaciones', 'I want a room for two', 'do you have a person limit per room?',
  'how much is the yoga class', 'I talked to the owner yesterday', '', '   ', '¿Alguien habla inglés?',
];

describe('pideHumano', () => {
  it.each(SI)('SÍ detecta: %s', (t) => expect(pideHumano(t)).toBe(true));
  it.each(NO)('NO detecta: "%s"', (t) => expect(pideHumano(t)).toBe(false));
});

describe('reglaPidioHumano', () => {
  const turno = (...c: string[]) => ({ mensajes: c.map((contenido) => ({ contenido, tipo: 'texto' })), textoAgrupado: c.join('\n') }) as never;
  it('pide persona → escalar con motivo pidio_humano', async () => {
    expect(await reglaPidioHumano.evaluar(turno('quiero hablar con alguien'), {} as never, {} as never))
      .toEqual({ tipo: 'escalar', motivo: 'pidio_humano', mensajeAlHuesped: null });
  });
  it('detecta el pedido aunque venga en el segundo mensaje del turno', async () => {
    const d = await reglaPidioHumano.evaluar(turno('hola', 'me pasas con una persona'), {} as never, {} as never);
    expect(d?.tipo).toBe('escalar');
  });
  it('mensaje normal → null', async () => {
    expect(await reglaPidioHumano.evaluar(turno('cuánto cuesta el café'), {} as never, {} as never)).toBeNull();
  });
});

describe('rutear con pidioHumano', () => {
  const cfg = { temasQueEscalan: ['india'] } as never;
  const turno = (texto: string, tipo = 'texto') => ({ mensajes: [{ contenido: texto, tipo }], textoAgrupado: texto }) as never;
  it('pedir una persona gana sobre un tema de alto valor', async () => {
    const d = await rutear(turno('quiero hablar con alguien sobre India'), { estadoBot: 'activo' } as never, cfg);
    expect(d).toMatchObject({ tipo: 'escalar', motivo: 'pidio_humano' });
  });
  it('un tema de alto valor sin pedir persona sigue igual', async () => {
    const d = await rutear(turno('cuéntame del viaje a India'), { estadoBot: 'activo' } as never, cfg);
    expect(d).toMatchObject({ tipo: 'escalar', motivo: 'fuera_de_alcance' });
  });
  it('con el bot pausado, pedir una persona no responde (ya lo atienden)', async () => {
    const d = await rutear(turno('quiero hablar con alguien'), { estadoBot: 'pausado' } as never, cfg);
    expect(d).toEqual({ tipo: 'ignorar', motivo: 'bot_pausado' });
  });
  it('un audio sin texto sigue siendo media', async () => {
    const d = await rutear(({ mensajes: [{ contenido: '', tipo: 'audio' }], textoAgrupado: '' }) as never, { estadoBot: 'activo' } as never, cfg);
    expect(d).toEqual({ tipo: 'media', tipos: ['audio'] });
  });
  it('texto normal va al modelo', async () => {
    expect(await rutear(turno('precio de la clase de yoga'), { estadoBot: 'activo' } as never, cfg)).toEqual({ tipo: 'llm' });
  });
});

describe('idioma del pedido', () => {
  it('"talk to a human" se detecta como inglés aunque la conversación venga en español', () => {
    expect(detectarIdioma('I want to talk to a human', 'es', ['es', 'en'])).toBe('en');
    expect(detectarIdioma('quiero hablar con una persona', 'en', ['es', 'en'])).toBe('es');
  });
});
