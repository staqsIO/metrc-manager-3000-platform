#!/usr/bin/env bash
# Builds the sibling client package so `file:../metrc-formul8-os-client` resolves to compiled output.
set -euo pipefail
CLIENT_DIR="$(cd "$(dirname "$0")/../../metrc-formul8-os-client" && pwd)"
npm --prefix "$CLIENT_DIR" ci
npm --prefix "$CLIENT_DIR" run build
