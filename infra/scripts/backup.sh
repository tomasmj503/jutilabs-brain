#!/bin/bash
# Respaldo diario JUTILABS. Corre como root. Guarda 7 días en /var/backups/jutilabs.
# Cron (root): 0 3 * * * /home/jutilabs/jutilabs-brain/infra/scripts/backup.sh >> /var/log/jutilabs-backup.log 2>&1
set -euo pipefail
umask 077
DEST=/var/backups/jutilabs
REPO=/home/jutilabs/jutilabs-brain
FECHA=$(date +%F)
mkdir -p "$DEST"; chmod 700 "$DEST"
TMP=$(mktemp -d "$DEST/.tmp.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
cd "$REPO/infra"
PGUSER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2-)
docker compose exec -T postgres pg_dumpall -U "$PGUSER" | gzip > "$TMP/postgres-$FECHA.sql.gz"
gzip -t "$TMP/postgres-$FECHA.sql.gz"
[ "$(stat -c%s "$TMP/postgres-$FECHA.sql.gz")" -gt 10000 ] || { echo "dump sospechosamente pequeño"; exit 1; }
for v in chatwoot_storage n8n_data caddy_data; do
  docker run --rm -v "jutilabs_${v}:/src:ro" -v "$TMP:/dest" alpine tar czf "/dest/${v}-$FECHA.tgz" -C /src .
done
tar czf "$TMP/secretos-$FECHA.tgz" -C "$REPO" .env infra/.env infra/.env.chatwoot
# Supabase (plan gratuito, sin respaldos propios). Solo esquema public.
# Viaja por una red con pérdida: hasta 3 intentos (20 s entre uno y otro). Cada intento tiene límite de 5 min
# (timeout) y se valida completo (tamaño + pg_restore --list). Entre intentos se borra el archivo parcial.
# Repetirlo es seguro: solo lee.
supabase_dump() {
  rm -f "$TMP"/supabase-*.dump
  ( source /etc/supabase-env && docker run --rm -e SUPABASE_DB_URL -e PGCONNECT_TIMEOUT=15 -v "$TMP:/dest" postgres:17 sh -c 'timeout 300 pg_dump "$SUPABASE_DB_URL" --schema=public --format=custom --no-owner --no-privileges --file="/dest/supabase-'"$FECHA"'.dump"' \
    && [ "$(stat -c%s "$TMP/supabase-$FECHA.dump")" -gt 10000 ] \
    && docker run --rm -v "$TMP:/dest:ro" postgres:17 pg_restore --list "/dest/supabase-$FECHA.dump" > /dev/null )
}
SUPA_FALLO=1
for i in 1 2 3; do
  if supabase_dump; then SUPA_FALLO=0; break; fi
  rm -f "$TMP"/supabase-*.dump
  echo "SUPABASE intento $i/3 falló $FECHA"
  [ "$i" = 3 ] || sleep 20
done
[ "$SUPA_FALLO" = 0 ] || echo "SUPABASE FALLO $FECHA"
chmod 600 "$TMP"/*
mv "$TMP"/* "$DEST"/
find "$DEST" -maxdepth 1 -type f -mtime +7 -delete
"$REPO/infra/scripts/offsite.sh"
[ "$SUPA_FALLO" = 0 ] || { echo "backup INCOMPLETO $FECHA (Supabase falló)"; exit 1; }
echo "backup ok $FECHA"
