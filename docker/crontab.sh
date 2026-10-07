#!/usr/bin/env bash
# Prints the supercronic crontab. Set a CRON_SYNC_* variable to "" to disable that job.
set -euo pipefail
E=/app/docker/entrypoint.sh
line() { [ -n "$1" ] && echo "$1 $E sync${2:+ $2}"; return 0; }
line "${CRON_SYNC_DAILY-0 7 * * *}" ""
line "${CRON_SYNC_FULL-0 8 1 * *}" "--mode=full"
line "${CRON_SYNC_SALES-0 * * * *}" "--only=active-sales"
