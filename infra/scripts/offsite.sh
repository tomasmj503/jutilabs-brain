#!/bin/bash
# Copia cifrada a Backblaze B2 con restic. Corre como root; la llama backup.sh.
set -euo pipefail
source /etc/restic-env
DEST=/var/backups/jutilabs
FECHA=$(date +%F)
cd "$DEST"
for i in 1 2 3; do
  restic backup --tag diario --host jutilabs-mandala ./*-"$FECHA".* && break
  [ "$i" = 3 ] && { echo "OFFSITE FALLO $FECHA"; exit 1; }
  sleep 30
done
restic forget --tag diario --host jutilabs-mandala --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
[ "$(date +%u)" = 7 ] && restic check
echo "offsite ok $FECHA"
