#!/usr/bin/env bash
# One-command setup of the gbrain maintenance cron service on Railway
# (project hotelclaw-brain). Run from apps/web:
#
#   RAILWAY_API_TOKEN=<account token> ./scripts/setup-railway-maintenance.sh
#
# Token: Railway dashboard → Account Settings → Tokens → Create token.
# COPY THE SECRET SHOWN ONCE (a token's name/id will NOT authenticate).
# The railway npm shim is broken (missing platform binary — silently does
# nothing); this script downloads the real binary if needed.
#
# What it does:
#   1. Links the hotelclaw-brain project.
#   2. Creates/deploys the `brain-maintenance` service from
#      infra/railway-brain-maintenance (stateless — config generated from
#      env; state lives in the shared Supabase Postgres).
#   3. Sets GBRAIN_DATABASE_URL (read from the local gbrain config) and
#      OPENAI_API_KEY (from .env.local).
#   4. Sets the hourly cron schedule (embed hourly; dream 02:xx; doctor
#      09:xx — the entrypoint decides by UTC hour).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra/railway-brain-maintenance"
SERVICE_NAME="brain-maintenance"
CRON="0 * * * *"

if [ -z "${RAILWAY_API_TOKEN:-}" ]; then
  echo "RAILWAY_API_TOKEN is required (account token secret)." >&2
  exit 1
fi

# ── Real railway binary (the npm shim exits silently) ──────────────────────
RW="$(command -v railway || true)"
if [ -z "$RW" ] || ! "$RW" --version >/dev/null 2>&1; then
  RW="/tmp/railway-cli/railway"
  if ! "$RW" --version >/dev/null 2>&1; then
    echo "Downloading railway CLI binary…"
    mkdir -p /tmp/railway-cli && cd /tmp/railway-cli
    curl -sL -o railway.tar.gz \
      "$(curl -sL https://api.github.com/repos/railwayapp/cli/releases/latest \
        | grep -o '"browser_download_url": *"[^"]*aarch64-apple-darwin[^"]*"' \
        | head -1 | cut -d'"' -f4)"
    tar xzf railway.tar.gz
  fi
fi
"$RW" --version

# ── Auth sanity ────────────────────────────────────────────────────────────
if ! "$RW" whoami >/dev/null 2>&1; then
  echo "Token rejected by Railway — make sure you pasted the SECRET, not the token name/id." >&2
  exit 1
fi
"$RW" whoami

# ── Link the brain project ─────────────────────────────────────────────────
cd "$INFRA_DIR"
"$RW" link --project hotelclaw-brain --environment production 2>/dev/null \
  || "$RW" link -p hotelclaw-brain -e production

# ── Secrets for the service ────────────────────────────────────────────────
GBRAIN_CONFIG="$HOME/Desktop/hotelclaw-brains/.gbrain-homes/shared/.gbrain/config.json"
DB_URL="$(python3 -c "import json;print(json.load(open('$GBRAIN_CONFIG'))['database_url'])")"
OPENAI_KEY="$(grep '^OPENAI_API_KEY=' "$REPO_ROOT/apps/web/.env.local" | cut -d= -f2- || true)"

# ── Create + deploy the service ────────────────────────────────────────────
"$RW" add --service "$SERVICE_NAME" 2>/dev/null || true
"$RW" variables --service "$SERVICE_NAME" \
  --set "GBRAIN_DATABASE_URL=$DB_URL" \
  ${OPENAI_KEY:+--set "OPENAI_API_KEY=$OPENAI_KEY"} \
  --skip-deploys
"$RW" up --service "$SERVICE_NAME" --detach

# ── Cron schedule (GraphQL — the CLI has no cron flag) ─────────────────────
PROJECT_ID="$("$RW" status --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])" 2>/dev/null || true)"
echo
echo "Deployed. Final step — set the cron schedule ($CRON) on '$SERVICE_NAME':"
echo "  Railway dashboard → hotelclaw-brain → $SERVICE_NAME → Settings → Cron Schedule → $CRON"
echo "(Cron makes Railway run the service to completion on schedule instead of keeping it alive.)"
echo
echo "Verify after the next top of the hour: service logs should show '[maintenance] embed --stale' then '[maintenance] done'."
