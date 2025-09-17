#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F_%H%M%S)
OUT=/backup/db_dump_${STAMP}.sql
mkdir -p /backup
pg_dump -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" > "${OUT}"
echo "DB dump created at ${OUT}"
