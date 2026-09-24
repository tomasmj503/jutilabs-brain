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
# Mantenimiento (retención y verificación): también viaja por la red con pérdida. Repetirlo es seguro.
# Antes de cada reintento se quitan locks huérfanos del intento anterior (`restic unlock` solo quita los vencidos).
reintentar() {
  local nombre=$1 i; shift
  for i in 1 2 3; do
    "$@" && return 0
    echo "OFFSITE $nombre intento $i/3 falló $FECHA"
    [ "$i" = 3 ] || { sleep 30; restic unlock >/dev/null 2>&1 || true; }
  done
  return 1
}
MANT=0
reintentar "forget" restic forget --tag diario --host jutilabs-mandala --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune \
  || { echo "OFFSITE forget FALLO $FECHA"; MANT=1; }
if [ "$(date +%u)" = 7 ]; then
  reintentar "check" restic check || { echo "OFFSITE check FALLO $FECHA"; MANT=1; }
fi
[ "$MANT" = 0 ] || exit 1
echo "offsite ok $FECHA"
