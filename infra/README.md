# infra — primer arranque en el CX32

Orden. No saltar pasos.

1. Servidor: Ubuntu 24.04, `ufw` (22, 80, 443 únicamente), usuario no-root, Docker + compose plugin.
2. DNS (registrador de jutilabs.com): registros A `chat`, `n8n`, `api` → IP del servidor. Sin esto Caddy no emite certificados.
3. Clonar el repo en `/opt/jutilabs-brain`. Copiar `infra/.env.example` → `infra/.env`, `infra/.env.chatwoot.example` → `infra/.env.chatwoot`, `.env.example` → `.env` (raíz). Llenar TODO.
4. `cd infra && docker compose up -d postgres redis` — esperar `healthy` (`docker compose ps`).
5. Preparar Chatwoot (una sola vez): `docker compose run --rm chatwoot-rails bundle exec rails db:chatwoot_prepare`
6. `docker compose up -d` — Caddy pide certificados solo.
7. Super Admin de Chatwoot: `docker compose exec chatwoot-rails bundle exec rails c` → crear `SuperAdmin`. Luego en `/super_admin`: cuenta "Mandala", cuenta "pruebas", agentes.
8. Pinear versiones en `infra/.env` (`docker image inspect chatwoot/chatwoot:latest --format '{{index .RepoDigests 0}}'`).
9. Backup: cron de `scripts/backup.sh` y **una restauración de prueba** en un volumen limpio.

Verificación: `curl https://api.jutilabs.com/health` → `{"ok":true,...}`. `https://chat.jutilabs.com` carga login.

Riesgos conocidos: correo SMTP pendiente (bloquea invitaciones de agentes); imágenes `latest` hasta pinear; app Embedded Signup — una sola por instancia de Chatwoot (la de Mandala).
