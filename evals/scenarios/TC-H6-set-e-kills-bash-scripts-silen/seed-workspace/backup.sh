#!/usr/bin/env bash
# backup.sh — PostgreSQL database backup to S3

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/backup_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting backup..."

# Dump and compress — if pg_dump fails the whole script dies silently
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

echo "[$(date)] Uploading to s3://${S3_BUCKET}/backups/backup_${TIMESTAMP}.sql.gz ..."

aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/backups/backup_${TIMESTAMP}.sql.gz"

echo "[$(date)] Cleaning up local file..."

# Non-critical cleanup — if this fails set -e aborts without any message
rm "$BACKUP_FILE"

# Non-critical: prune old backups older than 30 days; a missing/empty bucket
# will make aws s3 ls exit 1, silently killing the script here too
aws s3 ls "s3://${S3_BUCKET}/backups/" \
  | awk '{print $4}' \
  | sort \
  | head -n -30 \
  | xargs -I{} aws s3 rm "s3://${S3_BUCKET}/backups/{}"

echo "[$(date)] Backup complete."
