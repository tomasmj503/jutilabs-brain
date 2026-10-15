import { describe, it, expect } from 'vitest';
import { reglaFueraDeAlcance } from '../../src/router/reglas/fueraDeAlcance.js';
import type { ClienteConfig } from '../../src/types/index.js';

const cfg = { temasQueEscalan: ['india', 'voluntariado', 'retiros'] } as unknown as ClienteConfig;
const turno = (texto: string) => ({ textoAgrupado: texto }) as never;
const evaluar = (texto: string, temas = cfg.temasQueEscalan) =>
  reglaFueraDeAlcance.evaluar(turno(texto), {} as never, { temasQueEscalan: temas } as unknown as ClienteConfig);

describe('reglaFueraDeAlcance', () => {
  it('detecta un tema de alto valor y dice cuál', async () => {
    const d = await evaluar('quiero info del viaje a India');
    expect(d).toEqual({ tipo: 'escalar', motivo: 'fuera_de_alcance', mensajeAlHuesped: null, tema: 'india' });
  });
  it('no detecta nada si no toca ningún tema', async () => {
    expect(await evaluar('¿cuánto cuesta la clase suelta?')).toBeNull();
  });
  it('no distingue mayúsculas ni tildes', async () => {
    const d = await evaluar('¿INFORMACIÓN SOBRE VOLUNTARIADO?');
    expect(d?.tipo).toBe('escalar');
  });

  // #3 / PC-12 (UNI-TEMAS): palabra COMPLETA, no subcadena.
  it.each([
    ['Indiana'], ['tengo un amigo indiano'], ['¿hay informaciones del lugar?'], ['las transformaciones del hostal'],
    ['la comida india'.replace('india', 'indiaca')], ['sindia'],
  ])('«%s» NO dispara el tema «india»', async (texto) => {
    expect(await evaluar(texto, ['india'])).toBeNull();
  });
  it.each([
    ['India'], ['viaje a la INDIA!'], ['india, 2027'], ['info de india'], ['¿Y la India?'],
  ])('«%s» SÍ dispara «india»', async (texto) => {
    expect(await evaluar(texto, ['india'])).toMatchObject({ tipo: 'escalar', tema: 'india' });
  });
  it('un tema de varias palabras se compara completo y en orden', async () => {
    expect(await evaluar('quiero un retiro de yoga', ['retiro de yoga'])).toMatchObject({ tema: 'retiro de yoga' });
    expect(await evaluar('un retiro y luego yoga', ['retiro de yoga'])).toBeNull();
    expect(await evaluar('retiros de yoga', ['retiro de yoga'])).toBeNull();
  });
  it('un tema vacío o solo de signos no dispara todo', async () => {
    expect(await evaluar('hola', ['', '  ', '!!!'])).toBeNull();
  });
});
