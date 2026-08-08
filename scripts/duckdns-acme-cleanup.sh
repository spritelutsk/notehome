#!/bin/bash
# Certbot manual cleanup hook: clears the DuckDNS TXT record set by duckdns-acme-auth.sh.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
source "$APP_DIR/.env"
set +a

curl -fsS -m 15 \
  "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&txt=removed&clear=true" >/dev/null || true
