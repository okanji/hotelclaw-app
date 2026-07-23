#!/usr/bin/env bash
# gbrain maintenance run — executed by Railway on the service's cron
# schedule (hourly). Decides what to do from the UTC hour:
#   every run   → embed --stale   (new chunks invisible to vector search
#                                  without it — gbrain live-sync.md)
#   02:xx UTC   → dream, per source (compiled-truth consolidation — "the
#                                  brain slowly rots" without it)
#   09:xx UTC   → doctor          (daily heartbeat: db/embedding/integrity)
#
# Env (set on the Railway service):
#   GBRAIN_DATABASE_URL  — the shared Supabase Postgres URL (same as serve)
#   OPENAI_API_KEY       — embeddings (text-embedding-3-small)
#   MAINTENANCE_MODE     — optional override: embed|dream|doctor|all
set -uo pipefail

GBRAIN_HOME="${GBRAIN_HOME:-/tmp/gbrain-home}"
export GBRAIN_HOME
GBRAIN="bun run /app/node_modules/gbrain/src/cli.ts"

# Stateless config: generated per run from env (state lives in Postgres).
mkdir -p "$GBRAIN_HOME/.gbrain"
cat > "$GBRAIN_HOME/.gbrain/config.json" <<EOF
{
  "engine": "postgres",
  "database_url": "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL must be set}",
  "embedding_disabled": false,
  "schema_pack": "gbrain-base-v2",
  "mcp": { "publish_skills": true },
  "self_upgrade": { "mode": "off" },
  "embedding_model": "openai:text-embedding-3-small",
  "embedding_dimensions": 1536
}
EOF

hour="$(date -u +%H)"
mode="${MAINTENANCE_MODE:-auto}"

each_source() {
  # Per-PROPERTY sources only (prop-<hex> — single-token, so column parsing
  # is safe by construction). Multi-word curated sources ("Oamar portfolio",
  # "Hotelclaw expertise") would be mangled by $1 AND are human-maintained —
  # the dream cycle is for sources that accumulate bot evidence.
  $GBRAIN sources list --timeout=45s 2>/dev/null | awk '{print $1}' | grep -E '^prop-' || true
}

run_embed() {
  echo "[maintenance] embed --stale"
  timeout 900 $GBRAIN embed --stale || echo "[maintenance] embed failed (non-fatal)"
}

run_dream() {
  for src in $(each_source); do
    echo "[maintenance] dream --source $src"
    timeout 1800 $GBRAIN dream --source "$src" || echo "[maintenance] dream $src failed (non-fatal)"
  done
}

run_doctor() {
  echo "[maintenance] doctor"
  timeout 600 $GBRAIN doctor || echo "[maintenance] doctor reported issues (see above)"
}

case "$mode" in
  embed)  run_embed ;;
  dream)  run_dream; run_embed ;;
  doctor) run_doctor ;;
  all)    run_doctor; run_dream; run_embed ;;
  auto)
    run_embed
    [ "$hour" = "02" ] && run_dream
    [ "$hour" = "09" ] && run_doctor
    ;;
  *) echo "unknown MAINTENANCE_MODE: $mode" >&2; exit 2 ;;
esac

echo "[maintenance] done ($(date -u +%FT%TZ), hour=$hour, mode=$mode)"
