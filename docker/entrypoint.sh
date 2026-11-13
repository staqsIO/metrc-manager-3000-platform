#!/usr/bin/env bash
set -euo pipefail
cd /app
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-${APP_URL:-http://localhost:3000}}"

# One-shot commands may start before the database accepts connections: compose start-up,
# or a serverless/sleeping database that only wakes on the first connection attempt.
wait_for_db() {
  local deadline=$((SECONDS + ${DB_WAIT_SECONDS:-90}))
  until echo 'SELECT 1;' | node_modules/.bin/prisma db execute --stdin --url "${DATABASE_URL:-}" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then echo "[db] not reachable after ${DB_WAIT_SECONDS:-90}s" >&2; return 1; fi
    echo "[db] waiting for database..."; sleep 3
  done
}

cmd="${1:-web}"; shift || true
case "$cmd" in migrate|demo-reset|sync|create-admin) wait_for_db ;; esac
case "$cmd" in
  web)          exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}" ;;
  migrate)      node_modules/.bin/prisma migrate deploy
                node_modules/.bin/tsx prisma/seed.ts
                if [ -f scripts/bootstrap-llm-from-env.ts ]; then node_modules/.bin/tsx scripts/bootstrap-llm-from-env.ts; fi ;;
  demo-reset)   # Destructive: wipes the whole database and reseeds fictional demo data.
                [ "${DEMO_MODE:-}" = "1" ] || { echo "demo-reset refused: set DEMO_MODE=1" >&2; exit 2; }
                node_modules/.bin/prisma migrate reset --force --skip-seed --skip-generate
                node_modules/.bin/tsx prisma/seed.ts
                exec node_modules/.bin/tsx scripts/seed-demo.ts ;;
  sync)         exec node_modules/.bin/tsx scripts/sync-all-facilities.ts "$@" ;;
  create-admin) exec node_modules/.bin/tsx scripts/create-admin.ts "$@" ;;
  cron)         bash /app/docker/crontab.sh > /tmp/crontab
                if ! grep -qvE '^\s*(#|$)' /tmp/crontab; then
                  echo "[cron] all jobs disabled"
                  trap 'exit 0' TERM INT; sleep infinity & wait
                fi
                echo "[cron] schedule:"; cat /tmp/crontab
                exec /usr/local/bin/supercronic /tmp/crontab ;;
  *)            exec "$cmd" "$@" ;;
esac
