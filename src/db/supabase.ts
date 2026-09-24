import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { crearFetch } from '../red/reintento.js';

/** Cliente con service role. RLS no aplica aquí: por eso TODA consulta filtra por cliente_id en código. */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  // Límite de 6 s por intento y hasta 3 intentos ante fallas pasajeras de red. Es seguro porque todo lo
  // que el cerebro escribe aquí se puede repetir: los guardados tienen llave única (el duplicado, código
  // 23505, se ignora) y los cambios de estado dejan el mismo resultado.
  global: { fetch: crearFetch({ nombre: 'supabase', politica: 'segura', timeoutMs: 6_000 }) },
});
