#!/usr/bin/env bash
# gbrain lifecycle maintenance — RUNS ON THE BRAIN HOST (the Railway
# `hotelclaw-brain` service, where the gbrain CLI + GBRAIN_HOME volume
# live). These are localOnly ops: they cannot be routed through MCP
# (gbrain docs: agent-to-gbrain.md, Surface 2).
#
# Per gbrain's operational disciplines the brain "slowly rots" without:
#   • sync + embed --stale  (new/changed pages invisible to vector search)
#   • nightly dream cycle   (compiled-truth consolidation from timelines)
#   • daily doctor          (db/embedding/sync/page-integrity heartbeat)
#
# Wire-up on Railway: add a cron service (same image/volume as the serve)
# running this script, or three schedules calling it with an argument:
#   brain-maintenance.sh sync    # every 15-30 min
#   brain-maintenance.sh doctor  # daily 09:00
#   brain-maintenance.sh dream   # nightly 02:00
#
# Per-source loop + lock-breaking per the gbrain README's federated-brain
# cron pattern. Requires: gbrain on PATH, GBRAIN_HOME set (the /data
# volume), DB env as configured for the serve.
set -uo pipefail

MODE="${1:-sync}"

break_stale_locks() {
  gbrain sync --break-lock --all --max-age 1800 || true
}

each_source() {
  # Per-PROPERTY sources only (prop-<hex> — single-token, so column parsing
  # is safe). Multi-word curated sources would be mangled by $1 and are
  # human-maintained; the dream cycle targets bot-evidence sources.
  gbrain sources list --timeout=45s 2>/dev/null | awk '{print $1}' | grep -E '^prop-' || true
}

case "$MODE" in
  sync)
    break_stale_locks
    for src in $(each_source); do
      timeout 600 gbrain sync --source "$src" --timeout 540 || true
    done
    gbrain embed --stale || true
    ;;
  doctor)
    gbrain doctor || true
    ;;
  dream)
    break_stale_locks
    for src in $(each_source); do
      timeout 1800 gbrain dream --source "$src" || true
    done
    gbrain embed --stale || true
    ;;
  *)
    echo "usage: $0 sync|doctor|dream" >&2
    exit 2
    ;;
esac
