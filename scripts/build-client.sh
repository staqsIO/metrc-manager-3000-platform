#!/usr/bin/env bash
# Builds the sibling client package so `file:../metrc-manager-3000-client` resolves to compiled output.
set -euo pipefail
CLIENT_DIR="$(cd "$(dirname "$0")/../../metrc-manager-3000-client" && pwd)"
npm --prefix "$CLIENT_DIR" ci
npm --prefix "$CLIENT_DIR" run build
