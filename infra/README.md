# infra — primer arranque en el CX32

Orden. No saltar pasos.

1. Servidor: Ubuntu 24.04, `ufw` (22, 80, 443 únicamente), usuario no-root, Docker + compose plugin.
2. DNS (registrador de jutilabs.com): registros A `chat`, `n8n`, `api` → IP del servidor. Sin esto Caddy no emite certificados.
3. Clonar el repo en `~/jutilabs-brain` (home del usuario del servidor). Copiar `infra/.env.example` → `infra/.env`, `infra/.env.chatwoot.example` → `infra/.env.chatwoot`, `.env.example` → `.env` (raíz). Llenar TODO.
4. `cd infra && docker compose up -d postgres redis redis-brain` — esperar `healthy` (`docker compose ps`).
5. Preparar Chatwoot (una sola vez): `docker compose run --rm chatwoot-rails bundle exec rails db:chatwoot_prepare`
6. `docker compose up -d` — Caddy pide certificados solo.
7. Super Admin de Chatwoot: `docker compose exec chatwoot-rails bundle exec rails c` → crear `SuperAdmin`. Luego en `/super_admin`: cuenta "Mandala", cuenta "pruebas", agentes.
8. Pinear versiones en `infra/.env` (`docker image inspect chatwoot/chatwoot:latest --format '{{index .RepoDigests 0}}'`).
9. Backup: cron de `scripts/backup.sh` y **una restauración de prueba** en un volumen limpio.

Verificación: `curl https://api.jutilabs.com/health` → `{"ok":true,...}`. `https://chat.jutilabs.com` carga login.

Riesgos conocidos: correo SMTP pendiente (bloquea invitaciones de agentes); imágenes `latest` hasta pinear; app Embedded Signup — una sola por instancia de Chatwoot (la de Mandala).

## Redis del cerebro (ADR-17)

`redis-brain` es una instancia PROPIA del cerebro (candados, buffer, dedup), aparte del `redis` de Chatwoot, con
`--maxmemory 256mb --maxmemory-policy noeviction`. Contraseña propia: `BRAIN_REDIS_PASSWORD` en `infra/.env`.
- Arranca vacío: al cambiar de Redis compartido a este se pierden los candados, buffers y marcas de dedup en vuelo
  (pasan unos segundos). Hacerlo con poco tráfico.
- Memoria: `docker compose exec -e REDISCLI_AUTH="$(grep '^BRAIN_REDIS_PASSWORD=' .env | cut -d= -f2-)" redis-brain redis-cli INFO memory`
  y leer `used_memory_human`. Si se acerca a 256 MB, subir `--maxmemory` (S-13).
- Si se llena, las escrituras fallan (a propósito): la bandeja durable (`mensajes.atendido_at`) retoma lo que
  quedó sin atender; no se pierde nada.

## Desplegar y volver atrás

La imagen del cerebro se etiqueta con el commit: `jutilabs/brain:<sha7>` (la CI la construye con ese nombre).

1. **Migraciones primero.** Aplicar a mano, en el SQL Editor de Supabase, `supabase/migrations/0002_*.sql` y `0003_*.sql`
   (aditivas: columnas nullable, índices parciales y un dato). Sin `0002` el cerebro nuevo no puede guardar mensajes.
2. En `infra/.env`: `BRAIN_REDIS_PASSWORD` y `BRAIN_TAG=<sha7 del commit a desplegar>`.
   Opcional (ruta nueva del webhook): variable de secreto de 32+ caracteres y `clientes.chatwoot_webhook_secret_ref`.
3. Construir con la etiqueta: `cd infra && BRAIN_TAG=<sha7> docker compose build brain`.
4. `docker compose up -d redis-brain brain`. Humo: `curl https://api.jutilabs.com/health`; y, desde el servidor,
   `docker compose exec brain wget -qO- http://127.0.0.1:8080/health/ready` (200 = listo).
5. **Volver atrás:** poner `BRAIN_TAG=<sha7 anterior>` y `docker compose up -d brain` (la imagen anterior sigue en el
   servidor mientras no se haga `docker image prune`). `0002` y `0003` no hay que revertirlas: el código anterior convive
   con ellas. Si además se vuelve al Redis compartido, restaurar `REDIS_URL` anterior en el servicio `brain`.

`/health/ready` es solo para el monitor externo (UptimeRobot / Healthchecks). El `HEALTHCHECK` de Docker usa `/health`:
un aviso al equipo que no sale NO debe reiniciar el contenedor.

## Editor de n8n (cerrado a internet)

Desde internet `n8n.jutilabs.com` solo deja pasar `/webhook/*`; todo lo demás da 404. Para editar flujos, desde la Mac:

    ssh -N -L 5678:127.0.0.1:5678 jutilabs@<IP del servidor>

y abrir `http://localhost:5678`. Cerrar con Ctrl+C.

## Versiones fijas

`caddy`, `postgres` y los dos `redis` van fijados por huella (`@sha256:…`); Chatwoot y n8n por versión en `infra/.env`.
Actualizar es una decisión a propósito: cambiar la huella o versión, desplegar y probar.
