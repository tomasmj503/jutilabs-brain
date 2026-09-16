#!/bin/bash
# Corre UNA sola vez, en el primer arranque del volumen de Postgres.
set -e

: "${POSTGRES_USER:?[init-db.sh] Falta POSTGRES_USER — define la variable en .env antes de levantar el stack}"
: "${N8N_DB_PASSWORD:?[init-db.sh] Falta N8N_DB_PASSWORD — define la variable en .env antes de levantar el stack}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE chatwoot;
  CREATE USER n8n WITH PASSWORD '$N8N_DB_PASSWORD';
  CREATE DATABASE n8n OWNER n8n;
  \c chatwoot
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL
