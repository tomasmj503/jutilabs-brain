#!/bin/bash
# Preflight: valida que los .env estén completos y consistentes ANTES de `docker compose up`.
# Uso (desde cualquier carpeta):  bash infra/scripts/preflight.sh
# Sale con código 1 si falta algo obligatorio. Los avisos no bloquean.
# No hace `source` de los .env (valores sin comillas con espacios romperían bash); los lee como lo hace compose.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> infra/
INFRA_ENV=.env
CHATWOOT_ENV=.env.chatwoot
BRAIN_ENV=../.env

ERRORES=0
AVISOS=0
rojo()  { printf '\033[31m✗ %s\033[0m\n' "$*"; ERRORES=$((ERRORES+1)); }
amar()  { printf '\033[33m! %s\033[0m\n' "$*"; AVISOS=$((AVISOS+1)); }
ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }

# leer KEY archivo -> imprime el valor (sin comillas ni comentario inline). Vacío si no existe.
leer() {
  local key=$1 archivo=$2 linea valor
  linea=$(grep -E "^[[:space:]]*${key}=" "$archivo" | tail -n1 || true)
  [ -z "$linea" ] && return 0
  valor=${linea#*=}
  valor=$(printf '%s' "$valor" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')
  valor=${valor#\"}; valor=${valor%\"}; valor=${valor#\'}; valor=${valor%\'}
  printf '%s' "$valor"
}

# exigir archivo KEY1 KEY2 ... -> error por cada KEY vacía
exigir() {
  local archivo=$1; shift
  local k v
  for k in "$@"; do
    v=$(leer "$k" "$archivo")
    if [ -z "$v" ]; then rojo "$archivo: falta $k"; else ok "$archivo: $k"; fi
  done
}

# exigir_patron archivo PREFIJO -> error si ninguna variable PREFIJO* tiene valor (no se hardcodea el cliente)
exigir_patron() {
  local archivo=$1 prefijo=$2 k v n=0
  for k in $(grep -oE "^[[:space:]]*${prefijo}[A-Z0-9_]+" "$archivo" | tr -d ' ' | sort -u); do
    v=$(leer "$k" "$archivo")
    [ -n "$v" ] && { ok "$archivo: $k"; n=$((n+1)); }
  done
  [ "$n" -eq 0 ] && rojo "$archivo: ninguna variable ${prefijo}* tiene valor (se necesita al menos una por cliente)"
  return 0
}

# min_len archivo KEY N -> aviso si el secreto es más corto que N (placeholder o clave débil)
min_len() {
  local v; v=$(leer "$2" "$1")
  [ -n "$v" ] && [ "${#v}" -lt "$3" ] && amar "$1: $2 tiene ${#v} caracteres (mínimo recomendado $3 — openssl rand -hex)"
  return 0
}

echo "== Preflight JUTILABS (infra/) =="

# 1. Existencia de archivos
for f in "$INFRA_ENV" "$CHATWOOT_ENV" "$BRAIN_ENV" Caddyfile docker-compose.yml init-db.sh; do
  [ -f "$f" ] && ok "existe $f" || rojo "no existe $f"
done
[ "$ERRORES" -gt 0 ] && { echo; echo "Faltan archivos. Copia los .env.example y llénalos antes de seguir."; exit 1; }

# 2. infra/.env — lo que interpola docker-compose.yml
echo; echo "-- $INFRA_ENV"
exigir "$INFRA_ENV" POSTGRES_USER POSTGRES_PASSWORD N8N_DB_PASSWORD REDIS_PASSWORD N8N_ENCRYPTION_KEY CHATWOOT_VERSION N8N_VERSION
min_len "$INFRA_ENV" POSTGRES_PASSWORD 24
min_len "$INFRA_ENV" N8N_DB_PASSWORD 24
min_len "$INFRA_ENV" REDIS_PASSWORD 24
min_len "$INFRA_ENV" N8N_ENCRYPTION_KEY 32
for k in CHATWOOT_VERSION N8N_VERSION; do
  [ "$(leer "$k" "$INFRA_ENV")" = "latest" ] && amar "$INFRA_ENV: $k=latest — pinear versión antes de producción (ver README)"
done

# 3. infra/.env.chatwoot — env_file de chatwoot-rails y chatwoot-sidekiq
echo; echo "-- $CHATWOOT_ENV"
exigir "$CHATWOOT_ENV" SECRET_KEY_BASE FRONTEND_URL POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME POSTGRES_PASSWORD REDIS_URL REDIS_PASSWORD
min_len "$CHATWOOT_ENV" SECRET_KEY_BASE 64
[ "$(leer ENABLE_ACCOUNT_SIGNUP "$CHATWOOT_ENV")" = "false" ] || amar "$CHATWOOT_ENV: ENABLE_ACCOUNT_SIGNUP debería ser false (las cuentas las crea el Super Admin)"
[ -n "$(leer SMTP_ADDRESS "$CHATWOOT_ENV")" ] || amar "$CHATWOOT_ENV: SMTP sin configurar — las invitaciones a agentes no llegarán"

# 4. Consistencia cruzada infra/.env <-> .env.chatwoot (el copy-paste que más duele)
echo; echo "-- consistencia $INFRA_ENV <-> $CHATWOOT_ENV"
cruzar() {  # cruzar KEY_INFRA KEY_CHATWOOT
  local a b; a=$(leer "$1" "$INFRA_ENV"); b=$(leer "$2" "$CHATWOOT_ENV")
  if [ -n "$a" ] && [ -n "$b" ]; then
    [ "$a" = "$b" ] && ok "$1 == $2" || rojo "$1 ($INFRA_ENV) no coincide con $2 ($CHATWOOT_ENV)"
  fi
}
cruzar POSTGRES_USER POSTGRES_USERNAME
cruzar POSTGRES_PASSWORD POSTGRES_PASSWORD
cruzar REDIS_PASSWORD REDIS_PASSWORD

# 5. ../.env — env_file del brain. Vars de cliente por patrón, sin hardcodear nombres.
echo; echo "-- $BRAIN_ENV (brain)"
exigir "$BRAIN_ENV" SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CHATWOOT_BASE_URL CHATWOOT_WEBHOOK_SECRET OPENROUTER_BASE_URL N8N_WEBHOOK_AVISOS N8N_WEBHOOK_SECRET
exigir_patron "$BRAIN_ENV" CHATWOOT_TOKEN_
exigir_patron "$BRAIN_ENV" OPENROUTER_KEY_
[[ "$(leer SUPABASE_URL "$BRAIN_ENV")" == *xxxx* ]] && rojo "$BRAIN_ENV: SUPABASE_URL sigue con el placeholder del ejemplo"

# 6. Que compose pueda interpolar todo el YAML
echo; echo "-- docker compose config"
if command -v docker >/dev/null 2>&1; then
  if docker compose config -q 2>/tmp/preflight-compose.err; then ok "docker compose config"; else rojo "docker compose config falló:"; sed 's/^/    /' /tmp/preflight-compose.err; fi
else
  amar "docker no está en PATH — no se pudo validar el compose (normal si corres esto fuera del servidor)"
fi

echo
if [ "$ERRORES" -gt 0 ]; then
  echo "PREFLIGHT FALLÓ: $ERRORES error(es), $AVISOS aviso(s). No levantes el stack hasta corregirlos."
  exit 1
fi
echo "PREFLIGHT OK: 0 errores, $AVISOS aviso(s). Puedes correr: docker compose up -d"
