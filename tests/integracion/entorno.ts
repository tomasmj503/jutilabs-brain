import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Direcciones de tests/integracion/docker-compose.yml. Se pueden pisar con variables de entorno (CI). */
export const URL_POSTGRES = process.env.INT_POSTGRES_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
export const URL_REDIS = process.env.INT_REDIS_URL ?? 'redis://127.0.0.1:63799';
export const URL_POSTGREST = process.env.INT_POSTGREST_URL ?? 'http://127.0.0.1:3009';
const SECRETO_JWT = process.env.INT_JWT_SECRET ?? 'jwt-secreto-solo-para-pruebas-de-integracion-0123456789';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** JWT HS256 con el rol pedido (lo valida PostgREST con el mismo secreto del compose). */
export function jwtDeRol(rol: 'service_role' | 'anon' | 'authenticated', extra: Record<string, unknown> = {}): string {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: rol, ...extra })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO_JWT).update(cuerpo).digest('base64url')}`;
}

/** Cliente supabase-js contra PostgREST (que no usa el prefijo /rest/v1 de Supabase). */
export function crearSupabaseDePrueba(): SupabaseClient {
  const alPostgrest: typeof fetch = (entrada, init) => fetch(String(entrada).replace('/rest/v1', ''), init);
  return createClient(URL_POSTGREST, jwtDeRol('service_role'), {
    auth: { persistSession: false },
    global: { fetch: alPostgrest },
  });
}

export async function conPg<T>(f: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: URL_POSTGRES });
  await c.connect();
  try {
    return await f(c);
  } finally {
    await c.end();
  }
}

export function crearRedisDePrueba(): Redis {
  return new Redis(URL_REDIS, { maxRetriesPerRequest: 2 });
}

/** Vacía las tablas de negocio (conserva el esquema) para que cada prueba parta limpia. */
export async function limpiarTablas(): Promise<void> {
  await conPg((c) => c.query('truncate table public.mensajes, public.leads, public.conversaciones, public.clientes cascade'));
}
