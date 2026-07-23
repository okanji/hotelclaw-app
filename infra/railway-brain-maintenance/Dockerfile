# gbrain maintenance cron service (Railway, project hotelclaw-brain).
# Runs the localOnly lifecycle ops the serve can't expose over MCP
# (agent-to-gbrain.md Surface 2): embed --stale hourly, dream nightly,
# doctor daily. Stateless by design — gbrain's real state lives in the
# shared Supabase Postgres; config.json is generated from env at boot,
# so NO volume is needed (Railway volumes are single-service anyway).
#
# Pin matches the serve deployment (gbrain#f72de97) — bump both together.
FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN bun init -y >/dev/null 2>&1 || true
RUN bun add gbrain@github:garrytan/gbrain#f72de97

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV GBRAIN_HOME=/tmp/gbrain-home
CMD ["/app/entrypoint.sh"]
