-- Roles que Supabase crea por su cuenta y que las migraciones y PostgREST suponen que existen.
-- Solo para las pruebas de integración.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authpass';
grant anon, authenticated, service_role to authenticator;
