import { defineHook } from "eve/hooks";
import { resolvePodContext } from "../lib/pods";
import { putBrainPage } from "../lib/gbrain-http";

/**
 * Outcome write-back (fleet spec M4.3): when a pod-bot session completes a
 * WRITE action (task created/updated, refund, rate override, comp night),
 * bank a timeline entry into the pod brain — outcomes and learnings, never
 * chatter. One entry per qualifying action; queries/reads never log.
 *
 * PII: only the tool's structured output is logged (titles, references,
 * statuses) — never conversation text. Fail-soft: while the brain endpoint
 * is offline this observes and drops (hooks are observe-only; a brain
 * outage must never affect the session).
 */
const WRITE_TOOLS = new Set([
  "create_task",
  "update_task",
  "refund_booking",
  "override_rate",
  "comp_night",
]);

export default defineHook({
  events: {
    async "action.result"(event, ctx) {
      const result = event.data?.result as
        | { toolName?: string; kind?: string; output?: unknown }
        | undefined;
      if (!result || result.kind !== "tool-result") return;
      const tool = result.toolName ?? "";
      if (!WRITE_TOOLS.has(tool)) return;
      const output = result.output as Record<string, unknown> | undefined;
      if (!output || output.error || output.unavailable) return;

      const pod = await resolvePodContext(ctx);
      if (!pod?.bot || !pod.brainUrl) return;

      const now = new Date();
      const stamp = now.toISOString();
      const day = stamp.slice(0, 10);
      const path = `timeline/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}-${tool}-${now.getTime().toString(36)}`;
      const markdown = [
        `# ${stamp} — ${tool} via ${pod.bot.displayName}`,
        ``,
        `- Property: properties/${pod.propertySlug}`,
        `- Action: \`${tool}\``,
        `- Outcome: \`${JSON.stringify(output).slice(0, 600)}\``,
        `- Citation: [brain: properties/${pod.propertySlug}] (entity pages to be enriched by the dream cycle)`,
      ].join("\n");

      const written = await putBrainPage(pod.brainUrl, pod.brainTokenRef, path, markdown);
      if (!written.ok) {
        console.warn("[outcomes-hook] brain write skipped:", written.reason);
      }
    },
  },
});
