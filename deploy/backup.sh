#!/usr/bin/env bash
#
# Nightly database backup.
#
# A backup that has never been restored is a hope, not a backup — so this pairs
# with restore.sh and the runbook tells you to run it quarterly against a
# scratch database. Untested backups are how companies discover their dumps have
# been zero bytes for eight months.
#
#   crontab -e
#   15 2 * * *  /opt/bela-hrms/deploy/backup.sh >> /var/log/bela-backup.log 2>&1

set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/bela-hrms}"
BACKUP_DIR="${BACKUP_DIR:-$STACK_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

cd "$STACK_DIR"
# shellcheck disable=SC1091
set -a; source .env; set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/bela-hrms-$STAMP.dump"

# --format=custom, not plain SQL: it restores selectively, in parallel, and
# compresses. A 200 MB plain dump is a 30 MB custom one.
docker compose exec -T postgres \
  pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
          --format=custom --compress=9 --no-owner --no-privileges \
  > "$TARGET"

# A dump that failed midway still creates a file. Verify it is readable before
# reporting success and before the retention sweep deletes an older good one.
if ! docker compose exec -T postgres pg_restore --list /dev/stdin < "$TARGET" > /dev/null 2>&1; then
  echo "$(date -Is)  FAILED: $TARGET is not a valid archive" >&2
  rm -f "$TARGET"
  exit 1
fi

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "$(date -Is)  ok  $TARGET ($SIZE)"

# Retention runs only after a verified success, so a run of failures can never
# delete the last good backup.
find "$BACKUP_DIR" -name 'bela-hrms-*.dump' -mtime "+$KEEP_DAYS" -delete

# Off-site. A backup on the same disk as the database survives a bad migration
# and nothing else — not a failed disk, not a deleted VPS, not ransomware.
if [ -n "${OFFSITE_TARGET:-}" ]; then
  rsync -az --delete "$BACKUP_DIR/" "$OFFSITE_TARGET/" \
    && echo "$(date -Is)  ok  mirrored to $OFFSITE_TARGET"
fi
