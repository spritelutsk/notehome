#!/bin/bash
# Certbot manual auth hook: publishes the ACME DNS-01 challenge as a DuckDNS TXT record.
# Certbot passes $CERTBOT_DOMAIN / $CERTBOT_VALIDATION in the environment.
# Reads DUCKDNS_DOMAIN / DUCKDNS_TOKEN from ../.env (kept out of git — see .env.example).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
source "$APP_DIR/.env"
set +a

RESPONSE=$(curl -fsS -m 15 \
  "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&txt=${CERTBOT_VALIDATION}")

if [ "$RESPONSE" != "OK" ]; then
  echo "DuckDNS TXT update failed: $RESPONSE" >&2
  exit 1
fi

# Wait for the record to actually be visible before handing control back to certbot —
# a premature return burns one of the 5 hourly validation failures Let's Encrypt allows.
RECORD="_acme-challenge.${CERTBOT_DOMAIN}"
for _ in $(seq 1 30); do
  sleep 5
  if dig +short TXT "$RECORD" @ns1.duckdns.org 2>/dev/null | grep -qF "$CERTBOT_VALIDATION"; then
    echo "TXT record for $RECORD is live"
    exit 0
  fi
done

echo "TXT record for $RECORD did not appear within 150s" >&2
exit 1
