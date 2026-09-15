#!/usr/bin/env bash
#
# Restore a dump. Destructive, and deliberately awkward about it.
#
#   ./deploy/restore.sh backups/bela-hrms-20260913-021500.dump
#
# Practise this on a scratch database before you need it. The first time anybody
# runs a restore should not be during an outage.

set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/bela-hrms}"
DUMP="${1:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: $0 <dump-file>" >&2
  exit 1
fi

cd "$STACK_DIR"
# shellcheck disable=SC1091
set -a; source .env; set +a

echo "This REPLACES the contents of '$POSTGRES_DB'. Everything currently in it is lost."
echo "Dump: $DUMP"
read -r -p "Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$POSTGRES_DB" ] || { echo "Aborted."; exit 1; }

# Stop the app first. Restoring under a live application produces foreign-key
# violations from writes landing between the drop and the recreate.
docker compose stop app

# --clean --if-exists drops each object before recreating it, so a restore over
# a partially-populated database succeeds instead of colliding.
docker compose exec -T postgres \
  pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
             --clean --if-exists --no-owner --no-privileges --exit-on-error \
  < "$DUMP"

# The dump may predate the deployed code. Migrations are idempotent, so this is
# safe either way and skipping it is how a restore ends in a schema mismatch.
docker compose run --rm migrate
docker compose start app

echo "Restored. Check https://${APP_DOMAIN}/api/health"
