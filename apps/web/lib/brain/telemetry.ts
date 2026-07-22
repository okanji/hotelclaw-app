import "server-only";
/**
 * Structured, greppable telemetry for every brain interaction that would
 * otherwise fail silently. One line per event, JSON payload, stable
 * `[brain:<event>]` prefix — replaces the scattered bare `catch {}` /
 * `console.warn` swallowing so brainless/unavailable paths are visible in
 * logs (and in /tmp/hotelclaw-dev.log during dev).
 */

export function logBrainEvent(
  event:
    | "capture_failed"
    | "capture_skipped_no_binding"
    | "doc_sync_ok"
    | "doc_sync_failed"
    | "doc_sync_skipped_no_binding"
    | "search_unavailable"
    | "provision_failed",
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify(fields);
  if (event.endsWith("failed")) {
    console.error(`[brain:${event}] ${line}`);
  } else {
    console.log(`[brain:${event}] ${line}`);
  }
}
