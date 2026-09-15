# jutilabs-brain

Cerebro conversacional multi-cliente de JUTILABS (WhatsApp + chat web vía Chatwoot). Cliente 1: Mandala Yoga Hostel.
Fuente de verdad del proyecto: Notion → "Mandala Yoga Hostel — Mandala AI (Proyecto)", §11.

## Reglas para agentes de código
Lee `.clinerules` antes de tocar nada. Resumen: contratos en `src/types/`, todo con `cliente_id`, decisiones de negocio en código, un mensaje por turno, pregunta antes de lecturas amplias.

## Arranque local
```bash
cp .env.example .env         # llenar Supabase (service role), Redis local, secretos
npm install
npm run typecheck
npm run dev                  # http://localhost:8080/health
```

## Infra (servidor)
Ver `infra/README.md`. Compose: Chatwoot + n8n + brain + Postgres + Redis + Caddy.

## Supabase
1. `supabase/migrations/0001_esquema_inicial.sql` en el SQL Editor del proyecto nuevo.
2. `supabase/seed/0001_clientes.sql` (tenant `pruebas` + Mandala).

## Estado
Semana 1 (sep-2026): esqueleto. Los módulos en `src/` son stubs con el contrato y el TODO del modelo que los implementa.
