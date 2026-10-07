#!/usr/bin/env bash
set -euo pipefail
cd /app
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-${APP_URL:-http://localhost:3000}}"

cmd="${1:-web}"; shift || true
case "$cmd" in
  web)          exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}" ;;
  migrate)      node_modules/.bin/prisma migrate deploy
                node_modules/.bin/tsx prisma/seed.ts
                if [ -f scripts/bootstrap-llm-from-env.ts ]; then node_modules/.bin/tsx scripts/bootstrap-llm-from-env.ts; fi ;;
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
