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
  # Single-token sources only ($1 column parsing is safe for them):
  # per-property (prop-<hex>), per-pod (pod-*), the master playbook, and
  # the canary fixture. Multi-word curated sources would be mangled by $1
  # and are human-maintained. master/pod/canary were added 2026-08-27:
  # doctor FAILED cycle_freshness because they had never completed a dream
  # cycle — its own prescription is `gbrain dream --source <id>` for each.
  gbrain sources list --timeout=45s 2>/dev/null | awk '{print $1}' | grep -E '^(prop-|pod-|master$|canary-fixture$)' || true
}

case "$MODE" in
  sync)
    break_stale_locks
    for src in $(each_source); do
      # NO --timeout flag on sync: in gbrain <=0.42 any --timeout routes
      # sync into the read-only command wrapper — a bare number is taken as
      # MILLISECONDS ("connect timed out" instantly), a unit-suffixed one
      # dies on "unsupported command". The shell `timeout 600` is the bound.
      timeout 600 gbrain sync --source "$src" || true
    done
    gbrain embed --stale || true
    # Edge extraction — gbrain's self-wiring knowledge graph, and the
    # reason it beats a plain vector index (+31.4pp P@5 upstream). It is
    # NOT part of sync/embed: without this the graph stays empty and every
    # retrieval is vector+keyword only. The 2026-08-06 audit found
    # link_count=0 across 111 pages with doctor reporting
    # "109/109 pages have un-extracted edges" — this line is that fix.
    gbrain extract --stale || true
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
    gbrain extract --stale || true
    ;;
  jobs)
    # Drain the durable job queue. Nothing registers a worker otherwise —
    # the audit found an embed-backfill job that had waited 464h ("no live
    # worker is registered for that queue"); draining it took 3.3s.
    #
    # `jobs work` is a DAEMON: it does NOT exit when the queue empties, so a
    # bare `timeout 600` burns the full 10 minutes on every idle run (first
    # cron run after this was added took 10m37s with nothing to do). Check
    # for waiting work first and only pay the timeout when there is some.
    #
    # Count with `grep -cw waiting`, NOT a leading-digit row match: the
    # table prints a footer ("1 jobs shown") that a `^\s+\d+\s` pattern also
    # matches, which would report a non-empty queue forever.
    pending=$(gbrain jobs list --status waiting --limit 5 2>/dev/null | grep -cw waiting || true)
    if [ "${pending:-0}" -gt 0 ]; then
      echo "draining ${pending} waiting job(s)"
      timeout 600 gbrain jobs work --queue default || true
    else
      echo "job queue empty, skipping worker"
    fi
    ;;
  reindex)
    # Clears the `contextual_retrieval_coverage` doctor warning: re-chunks
    # markdown pages below the current chunker version. Also re-embeds them
    # with the ACTIVE model, which is how 22 stale zeroentropy-era vectors
    # became openai ones (the corpus had two embedding spaces mixed).
    timeout 1800 gbrain reindex --markdown --yes || true
    gbrain embed --stale || true
    ;;
  *)
    echo "usage: $0 sync|doctor|dream|jobs|reindex" >&2
    exit 2
    ;;
esac
