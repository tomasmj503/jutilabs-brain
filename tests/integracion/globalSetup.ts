import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { URL_POSTGRES, URL_POSTGREST, URL_REDIS } from './entorno.js';
import { Redis } from 'ioredis';

const RAIZ = resolve(import.meta.dirname, '../..');
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function esperar<T>(que: string, intentar: () => Promise<T>, intentos = 60): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await intentar();
    } catch (e) {
      ultimo = e;
      await dormir(1000);
    }
  }
  throw new Error(`No quedó listo: ${que}. Último error: ${ultimo instanceof Error ? ultimo.message : String(ultimo)}. ¿Corriste "docker compose -f tests/integracion/docker-compose.yml up -d --wait"?`);
}

/**
 * Antes de las pruebas: recrea el esquema public, aplica supabase/migrations/*.sql EN ORDEN (la misma
 * carpeta que usa producción) y espera a Redis y PostgREST. Así cada corrida prueba las migraciones reales.
 */
export default async function setup(): Promise<void> {
  await esperar('Postgres', async () => {
    const c = new Client({ connectionString: URL_POSTGRES });
    await c.connect();
    await c.end();
  });
  const c = new Client({ connectionString: URL_POSTGRES });
  await c.connect();
  try {
    await c.query('drop schema if exists public cascade; create schema public;');
    await c.query(readFileSync(join(RAIZ, 'tests/integracion/bd/01-permisos.sql'), 'utf8'));
    const migraciones = readdirSync(join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const m of migraciones) {
      await c.query(readFileSync(join(RAIZ, 'supabase/migrations', m), 'utf8'));
    }
    await c.query("notify pgrst, 'reload schema'");
  } finally {
    await c.end();
  }
  await esperar('Redis', async () => {
    const r = new Redis(URL_REDIS, { maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await r.connect();
      await r.ping();
    } finally {
      r.disconnect();
    }
  });
  await esperar('PostgREST', async () => {
    const r = await fetch(`${URL_POSTGREST}/clientes?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${(await import('./entorno.js')).jwtDeRol('service_role')}` },
    });
    if (!r.ok) throw new Error(`PostgREST respondió ${r.status}`);
  });
}
