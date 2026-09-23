#!/bin/bash
# Envoltorio del cron: corre el respaldo y avisa a Healthchecks.io (0 = éxito, otro número = fallo).
# Cron (root): 0 3 * * * /home/jutilabs/jutilabs-brain/infra/scripts/backup-cron.sh >> /var/log/jutilabs-backup.log 2>&1
set -uo pipefail
/home/jutilabs/jutilabs-brain/infra/scripts/backup.sh
rc=$?
if [ -r /etc/healthchecks-env ]; then
  source /etc/healthchecks-env
  curl -fsS -m 10 --retry 5 -o /dev/null "$HC_PING_URL/$rc" || echo "AVISO: no se pudo avisar a Healthchecks (rc=$rc)"
else
  echo "AVISO: falta /etc/healthchecks-env, sin monitoreo"
fi
exit $rc
