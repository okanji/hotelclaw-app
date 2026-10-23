import { defineHook } from "eve/hooks";
import { resolvePodContext } from "../lib/pods";
import { memoryStore } from "../lib/memory-provider";

/**
 * Outcome write-back (fleet spec M4.3): when a pod-bot session completes a
 * WRITE action (task created/updated, refund, rate override, comp night),
 * bank an `outcome` row into property memory — outcomes and learnings,
 * never chatter. One row per qualifying action; queries/reads never log.
 *
 * PII: only the tool's structured output is logged (titles, references,
 * statuses) — never conversation text. Fail-soft: hooks are observe-only;
 * a memory write failure must never affect the session.
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
      if (!pod?.bot) return;

      try {
        await memoryStore().remember({
          scope: {
            propertyId: pod.caller.propertyId,
            subjectKind: "property",
            subjectId: pod.caller.propertyId,
          },
          kind: "outcome",
          content: `${pod.bot.displayName} ran ${tool}: ${JSON.stringify(output).slice(0, 600)}`,
          source: `pod bot ${pod.bot.botSlug}, ${new Date().toISOString().slice(0, 10)}`,
          tags: ["outcome", tool],
          importance: 1,
          createdVia: "app",
        });
      } catch (err) {
        console.warn("[outcomes-hook] memory write skipped:", err);
      }
    },
  },
});
