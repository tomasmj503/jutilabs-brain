import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default('info'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CHATWOOT_BASE_URL: z.string().url(),
  CHATWOOT_WEBHOOK_SECRET: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  N8N_WEBHOOK_AVISOS: z.string().url(),
  N8N_WEBHOOK_SECRET: z.string().min(1),
  BUFFER_MS: z.coerce.number().default(8000),
  LOCK_TTL_MS: z.coerce.number().default(60000),
});

export type Env = z.infer<typeof esquema>;

export const env: Env = esquema.parse(process.env);

/** Lee un secreto por nombre de variable (ej. clientes.openrouter_key_ref). Falla si no existe. */
export function secretoPorRef(ref: string): string {
  const v = process.env[ref];
  if (!v) throw new Error(`Secreto no configurado: ${ref}`);
  return v;
}
