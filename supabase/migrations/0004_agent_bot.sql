-- ============================================================================
-- Agent Bot de Chatwoot — cambios de esquema (solo ADITIVOS: columnas nullable).
-- NO aplicada: se corre a mano en el SQL Editor de Supabase. El código lee ambas columnas con `?? null`, así que
-- también funciona antes de aplicarla (queda sin Agent Bot configurado). Vuelta atrás: ver los DROP comentados.
-- ============================================================================

-- Secreto del Agent Bot (firma HMAC X-Chatwoot-Signature de sus avisos) y token del Agent Bot (con él se escribe en
-- Chatwoot). Igual que chatwoot_token_ref: guardan el NOMBRE de la variable de entorno, nunca el secreto.
alter table public.clientes
  add column if not exists chatwoot_bot_secret_ref text,
  add column if not exists chatwoot_bot_token_ref text;

-- ---- Vuelta atrás (comentada a propósito) ----
-- alter table public.clientes drop column if exists chatwoot_bot_token_ref, drop column if exists chatwoot_bot_secret_ref;
