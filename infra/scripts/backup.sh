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
chmod 600 "$TMP"/*
mv "$TMP"/* "$DEST"/
find "$DEST" -maxdepth 1 -type f -mtime +7 -delete
"$REPO/infra/scripts/offsite.sh"
echo "backup ok $FECHA"
