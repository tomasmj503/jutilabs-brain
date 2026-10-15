import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

// #6 (UNI-SALUD): /health/ready para el monitor externo: Redis, Supabase, latido del barrido y avisos sin confirmar.
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/redis.js', () => ({ redis: {} }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/config/cliente.js', () => ({ cargarClientesActivos: async () => [] }));
const { evaluarListo, registrarSalud } = await import('../../src/operacion/listo.js');

const bien = {
  pingRedis: async () => undefined,
  consultarSupabase: async () => undefined,
  edadLatidoBandejaMs: () => 5_000,
  avisosSinConfirmar: async () => 0,
};

describe('evaluarListo', () => {
  it('todo bien → ok', async () => {
    expect(await evaluarListo(bien)).toMatchObject({ ok: true, redis: 'ok', supabase: 'ok', bandeja: { estado: 'ok' }, avisosSinConfirmar: 0 });
  });
  it('Redis caído → no listo', async () => {
    const r = await evaluarListo({ ...bien, pingRedis: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r).toMatchObject({ ok: false, redis: 'falla' });
  });
  it('Supabase caído → no listo', async () => {
    const r = await evaluarListo({ ...bien, consultarSupabase: async () => { throw new Error('fetch failed'); } });
    expect(r).toMatchObject({ ok: false, supabase: 'falla' });
  });
  it('latido de la bandeja de más de 3 min → no listo', async () => {
    const r = await evaluarListo({ ...bien, edadLatidoBandejaMs: () => 4 * 60_000 });
    expect(r).toMatchObject({ ok: false, bandeja: { estado: 'atrasada' } });
  });
  it('el barrido nunca latió → no listo', async () => {
    expect(await evaluarListo({ ...bien, edadLatidoBandejaMs: () => null })).toMatchObject({ ok: false, bandeja: { estado: 'sin_latido' } });
  });
  it('avisos al equipo sin confirmar → no listo (PC-15: queda visible)', async () => {
    expect(await evaluarListo({ ...bien, avisosSinConfirmar: async () => 2 })).toMatchObject({ ok: false, avisosSinConfirmar: 2 });
  });
  it('Redis que no responde ni falla (se cuelga) no cuelga el endpoint', async () => {
    vi.useFakeTimers();
    const p = evaluarListo({ ...bien, pingRedis: () => new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await p).toMatchObject({ ok: false, redis: 'falla' });
    vi.useRealTimers();
  });
});

describe('GET /health/ready', () => {
  it('200 si todo bien y 503 si algo falla', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = Fastify();
    await registrarSalud(app, bien);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    await app.close();
    const app2 = Fastify();
    await registrarSalud(app2, { ...bien, pingRedis: async () => { throw new Error('x'); } });
    const r = await app2.inject({ method: 'GET', url: '/health/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, redis: 'falla' });
    await app2.close();
  });
});
