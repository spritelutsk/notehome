#!/bin/bash
# Updates the DuckDNS A record to this machine's current public IP.
# Reads DUCKDNS_DOMAIN / DUCKDNS_TOKEN from ../.env (kept out of git — see .env.example).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
source "$APP_DIR/.env"
set +a

LOG="$APP_DIR/data/duckdns.log"

RESPONSE=$(curl -fsS -m 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" || echo "curl_failed")
echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') response=${RESPONSE}" >> "$LOG"

if [ "$RESPONSE" != "OK" ]; then
  echo "DuckDNS update failed: $RESPONSE" >&2
  exit 1
fi
