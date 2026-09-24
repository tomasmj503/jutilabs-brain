import { describe, it, expect } from 'vitest';
import { registrarEnCurso, cuantosEnCurso, esperarEnCurso } from '../../src/ingesta/enCurso.js';

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('registro de trabajos en curso', () => {
  it('sin trabajos, esperar devuelve al instante con 0 pendientes', async () => {
    const t0 = Date.now();
    expect(await esperarEnCurso(5_000)).toEqual({ pendientes: 0 });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('espera a que termine el trabajo y luego sale (sin agotar el tope)', async () => {
    registrarEnCurso(dormir(80));
    expect(cuantosEnCurso()).toBe(1);
    const t0 = Date.now();
    expect(await esperarEnCurso(5_000)).toEqual({ pendientes: 0 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(cuantosEnCurso()).toBe(0);
  });

  it('un trabajo que falla no rompe el registro y se cuenta como terminado', async () => {
    registrarEnCurso(Promise.reject(new Error('falló')));
    expect(await esperarEnCurso(1_000)).toEqual({ pendientes: 0 });
  });

  it('un trabajo nuevo que llega mientras se espera también se espera', async () => {
    registrarEnCurso(dormir(50));
    setTimeout(() => registrarEnCurso(dormir(120)), 20);
    const t0 = Date.now();
    expect(await esperarEnCurso(5_000)).toEqual({ pendientes: 0 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(130);
  });

  it('si un trabajo no termina, se rinde en el tope y dice cuántos quedaron', async () => {
    let soltar: () => void = () => undefined;
    registrarEnCurso(new Promise<void>((r) => { soltar = r; }));
    const t0 = Date.now();
    expect(await esperarEnCurso(150)).toEqual({ pendientes: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    soltar();
    expect(await esperarEnCurso(1_000)).toEqual({ pendientes: 0 });
  });
});
