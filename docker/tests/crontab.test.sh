#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
out="$(env -u CRON_SYNC_DAILY -u CRON_SYNC_FULL -u CRON_SYNC_SALES bash "$HERE/crontab.sh")"
echo "$out" | grep -qx '0 7 \* \* \* /app/docker/entrypoint.sh sync' || { echo "FAIL daily: $out"; exit 1; }
echo "$out" | grep -qx '0 8 1 \* \* /app/docker/entrypoint.sh sync --mode=full' || { echo "FAIL full"; exit 1; }
echo "$out" | grep -qx '0 \* \* \* \* /app/docker/entrypoint.sh sync --only=active-sales' || { echo "FAIL sales"; exit 1; }
out="$(CRON_SYNC_SALES= bash "$HERE/crontab.sh")"
if echo "$out" | grep -q 'active-sales'; then echo "FAIL: empty value should disable"; exit 1; fi
out="$(CRON_SYNC_DAILY= CRON_SYNC_FULL= CRON_SYNC_SALES= bash "$HERE/crontab.sh")"
[ -z "$out" ] || { echo "FAIL: all empty should print nothing: $out"; exit 1; }
grep -q "exec /usr/local/bin/supercronic " "$HERE/entrypoint.sh" || { echo "FAIL: supercronic must be exec'd by absolute path (PID 1 reaper re-execs argv0 without PATH lookup)"; exit 1; }
echo PASS
