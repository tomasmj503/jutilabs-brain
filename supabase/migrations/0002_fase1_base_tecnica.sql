-- ============================================================================
-- Fase 1 «base técnica» — cambios de esquema (solo ADITIVOS: columnas nullable e índices parciales).
-- NO aplicada: se corre a mano en el SQL Editor de Supabase ANTES de desplegar la imagen nueva.
-- El código anterior convive con estas columnas (no las lee). Vuelta atrás: ver los DROP comentados al final.
-- ============================================================================

-- #4 (ADR-06): secreto del webhook de Chatwoot POR CLIENTE. Guarda el NOMBRE de la variable de entorno
-- (mismo patrón que chatwoot_token_ref / openrouter_key_ref), nunca el secreto. El valor debe tener 32+ caracteres.
alter table public.clientes
  add column if not exists chatwoot_webhook_secret_ref text;

-- PC-13 / ADR-13 (bandeja durable): todo mensaje del huésped se guarda ANTES de responderle 200 a Chatwoot y queda
-- «sin atender» (atendido_at nulo) hasta que el bot responde o el equipo es avisado. Un barrido cada minuto
-- reintenta el turno o escala los mensajes que llevan más de 3 min sin atender.
alter table public.mensajes
  add column if not exists atendido_at timestamptz;

-- Índice parcial: el barrido solo mira los pendientes (muy pocos), no toda la tabla.
create index if not exists idx_mensajes_sin_atender
  on public.mensajes (cliente_id, created_at)
  where atendido_at is null and rol = 'huesped';

-- Los mensajes que ya existen se dan por atendidos (si no, el primer barrido intentaría responder historia vieja).
update public.mensajes set atendido_at = created_at where atendido_at is null;

-- PC-15: aviso al equipo que NO se pudo confirmar. Guarda lo que hay que reintentar (nota, motivo, desde cuándo)
-- hasta que el aviso salga; entonces se completa la escalación y se limpia. Si pasan 15 min sin confirmarse,
-- /health/ready lo muestra. {nota, motivo, pausar, texto_huesped, desde}
alter table public.conversaciones
  add column if not exists aviso_pendiente jsonb,
  add column if not exists aviso_pendiente_at timestamptz;

create index if not exists idx_conv_aviso_pendiente
  on public.conversaciones (cliente_id, aviso_pendiente_at)
  where aviso_pendiente_at is not null;

-- ---- Vuelta atrás (comentada a propósito) ----
-- drop index if exists public.idx_conv_aviso_pendiente;
-- alter table public.conversaciones drop column if exists aviso_pendiente_at, drop column if exists aviso_pendiente;
-- drop index if exists public.idx_mensajes_sin_atender;
-- alter table public.mensajes drop column if exists atendido_at;
-- alter table public.clientes drop column if exists chatwoot_webhook_secret_ref;
