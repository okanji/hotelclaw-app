#!/bin/sh
set -e
# Config is generated from env on first boot (volume-persisted after).
# Mirrors the local shared home's .gbrain/config.json — all real state
# (sources, pages, OAuth clients) lives in Postgres, shared with the
# local CLI host.
mkdir -p "$GBRAIN_HOME/.gbrain"
if [ ! -f "$GBRAIN_HOME/.gbrain/config.json" ]; then
cat > "$GBRAIN_HOME/.gbrain/config.json" <<EOF
{
  "engine": "postgres",
  "database_url": "${GBRAIN_DATABASE_URL}",
  "embedding_disabled": false,
  "schema_pack": "gbrain-base-v2",
  "mcp": { "publish_skills": true },
  "self_upgrade": { "mode": "notify", "mode_prompted": true },
  "embedding_model": "openai:text-embedding-3-small",
  "embedding_dimensions": 1536
}
EOF
fi
exec bun /app/node_modules/gbrain/src/cli.ts serve --http \
  --bind 0.0.0.0 \
  --port "${PORT:-3131}" \
  --public-url "${GBRAIN_PUBLIC_URL:-http://127.0.0.1:${PORT:-3131}}"
