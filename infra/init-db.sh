#!/bin/bash
# Corre UNA sola vez, en el primer arranque del volumen de Postgres.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE chatwoot;
  CREATE USER n8n WITH PASSWORD '$N8N_DB_PASSWORD';
  CREATE DATABASE n8n OWNER n8n;
  \c chatwoot
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL
