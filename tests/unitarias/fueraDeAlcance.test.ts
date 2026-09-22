import { describe, it, expect } from 'vitest';
import { reglaFueraDeAlcance } from '../../src/router/reglas/fueraDeAlcance.js';
import type { ClienteConfig } from '../../src/types/index.js';

const cfg = { temasQueEscalan: ['india', 'voluntariado', 'retiros'] } as unknown as ClienteConfig;
const turno = (texto: string) => ({ textoAgrupado: texto }) as never;

describe('reglaFueraDeAlcance', () => {
  it('detecta un tema de alto valor', async () => {
    const d = await reglaFueraDeAlcance.evaluar(turno('quiero info del viaje a India'), {} as never, cfg);
    expect(d).toEqual({ tipo: 'escalar', motivo: 'fuera_de_alcance', mensajeAlHuesped: null });
  });
  it('no detecta nada si no toca ningún tema', async () => {
    const d = await reglaFueraDeAlcance.evaluar(turno('¿cuánto cuesta la clase suelta?'), {} as never, cfg);
    expect(d).toBeNull();
  });
  it('no distingue mayúsculas ni tildes', async () => {
    const d = await reglaFueraDeAlcance.evaluar(turno('¿INFORMACIÓN SOBRE VOLUNTARIADO?'), {} as never, cfg);
    expect(d?.tipo).toBe('escalar');
  });
});
