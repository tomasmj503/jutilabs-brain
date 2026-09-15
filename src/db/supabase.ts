import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/** Cliente con service role. RLS no aplica aquí: por eso TODA consulta filtra por cliente_id en código. */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
