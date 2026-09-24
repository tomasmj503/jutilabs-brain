import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apagarOrdenado, TOPE_APAGADO_MS } from '../../src/apagado.js';
import { registrarEnCurso } from '../../src/ingesta/enCurso.js';

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('apagarOrdenado', () => {
  it('cierra el servidor ANTES de esperar los turnos, y espera a que terminen', async () => {
    const orden: string[] = [];
    let terminoTurno = false;
    registrarEnCurso(dormir(80).then(() => { terminoTurno = true; orden.push('turno terminó'); }));
    const cortados = await apagarOrdenado({
      senal: 'SIGTERM',
      cerrarServidor: async () => { orden.push('servidor cerrado'); },
      cerrarRedis: async () => { orden.push(terminoTurno ? 'redis cerrado tras turno' : 'redis cerrado ANTES'); },
      topeMs: 5_000,
    });
    expect(cortados).toBe(0);
    expect(orden).toEqual(['servidor cerrado', 'turno terminó', 'redis cerrado tras turno']);
  });

  it('si un turno no termina en el tope, lo dice y sigue con el cierre', async () => {
    registrarEnCurso(new Promise<void>(() => undefined));
    const cerrarRedis = vi.fn(async () => undefined);
    const cortados = await apagarOrdenado({ senal: 'SIGTERM', cerrarServidor: async () => undefined, cerrarRedis, topeMs: 100 });
    expect(cortados).toBe(1);
    expect(cerrarRedis).toHaveBeenCalled();
  });

  it('si cerrar el servidor falla, igual espera los turnos y cierra Redis', async () => {
    const cerrarRedis = vi.fn(async () => undefined);
    const cortados = await apagarOrdenado({
      senal: 'SIGINT', cerrarServidor: async () => { throw new Error('boom'); }, cerrarRedis, topeMs: 100,
    });
    expect(cortados).toBeGreaterThanOrEqual(0);
    expect(cerrarRedis).toHaveBeenCalled();
  });
});

describe('el tope de apagado y stop_grace_period van juntos', () => {
  it('stop_grace_period del servicio brain es mayor que el tope de espera del código', () => {
    const compose = readFileSync('infra/docker-compose.yml', 'utf8');
    const brain = compose.slice(compose.indexOf('\n  brain:'));
    const m = /stop_grace_period:\s*(\d+)s/.exec(brain);
    expect(m, 'falta stop_grace_period en el servicio brain').not.toBeNull();
    const gracia = Number(m?.[1]) * 1000;
    expect(gracia).toBeGreaterThan(TOPE_APAGADO_MS);
  });

  it('el tope es menor que el candado de la conversación (120 s): esperar más no serviría', () => {
    expect(TOPE_APAGADO_MS).toBeLessThan(120_000);
  });
});
