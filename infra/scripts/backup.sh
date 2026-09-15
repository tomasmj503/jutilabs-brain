#!/bin/bash
# Backup diario: dump de Postgres + volúmenes de Chatwoot/n8n/Caddy. Guarda 7 días en /var/backups/jutilabs.
# Cron sugerido (root): 0 3 * * * /opt/jutilabs-brain/infra/scripts/backup.sh >> /var/log/jutilabs-backup.log 2>&1
# Restauración: probar UNA vez en semana 1 (ver infra/README.md). Un backup no probado no es un backup.
set -euo pipefail
DEST=/var/backups/jutilabs
FECHA=$(date +%F)
mkdir -p "$DEST"
cd "$(dirname "$0")/.."
docker compose exec -T postgres pg_dumpall -U "${POSTGRES_USER:-jutilabs}" | gzip > "$DEST/postgres-$FECHA.sql.gz"
for v in chatwoot_storage n8n_data caddy_data; do
  docker run --rm -v "jutilabs_${v}:/src:ro" -v "$DEST:/dest" alpine tar czf "/dest/${v}-$FECHA.tgz" -C /src .
done
find "$DEST" -type f -mtime +7 -delete
echo "backup ok $FECHA"
