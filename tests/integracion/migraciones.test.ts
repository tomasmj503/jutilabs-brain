import { describe, it, expect } from 'vitest';
import { conPg } from './entorno.js';

describe('migraciones sobre Postgres real', () => {
  it('toda tabla de public tiene RLS activada y forzada (PC-22, INT-RLS)', async () => {
    const r = await conPg((c) => c.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not (c.relrowsecurity and c.relforcerowsecurity)`,
    ));
    expect(r.rows).toEqual([]);
  });

  it('las tablas de negocio existen (el esquema se aplicó completo)', async () => {
    const r = await conPg((c) => c.query(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    ));
    const nombres = r.rows.map((f: { tablename: string }) => f.tablename);
    for (const t of ['clientes', 'conversaciones', 'mensajes']) expect(nombres).toContain(t);
  });
});
