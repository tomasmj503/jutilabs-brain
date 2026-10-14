-- ============================================================================
-- Fase 1 «base técnica» — cambios de esquema (solo ADITIVOS: columnas nullable e índices parciales).
-- NO aplicada: se corre a mano en el SQL Editor de Supabase ANTES de desplegar la imagen nueva.
-- El código anterior convive con estas columnas (no las lee). Vuelta atrás: ver los DROP comentados al final.
-- ============================================================================

-- #4 (ADR-06): secreto del webhook de Chatwoot POR CLIENTE. Guarda el NOMBRE de la variable de entorno
-- (mismo patrón que chatwoot_token_ref / openrouter_key_ref), nunca el secreto. El valor debe tener 32+ caracteres.
alter table public.clientes
  add column if not exists chatwoot_webhook_secret_ref text;

-- ---- Vuelta atrás (comentada a propósito) ----
-- alter table public.clientes drop column if exists chatwoot_webhook_secret_ref;
