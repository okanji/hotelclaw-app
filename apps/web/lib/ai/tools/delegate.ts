import "server-only";
/**
 * `delegate_task` tool — Tier 1 → durable-agent handoff.
 *
 * In-app bots use this when a request doesn't fit a single turn: the work
 * goes to a durable eve session (the runtime that also powers the fleet
 * pod bots and the Agents section) and proceeds after this reply is sent.
 * Restarts don't kill it, and any money-moving step inside it parks for
 * human approval.
 *
 * OpenClaw is retired; eve owns the whole Tier-2 slot. Recurring
 * schedules aren't wired yet (eve schedules are authored files, not
 * per-request) — the tool says so honestly instead of pretending.
 *
 * Fail-soft: if the agent runtime is unreachable the tool reports it and
 * the bot tells the user, rather than silently dropping the task.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { BotScope } from "@/lib/ai/run-bot";
import { delegateToEve } from "@/lib/ai/eve-delegate";

const DelegateInput = z.object({
  brief: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      "A complete, self-contained task brief for the durable agent: what to do, relevant ids/names, what 'done' looks like. It has no access to this conversation — include everything it needs.",
    ),
  summary: z
    .string()
    .max(280)
    .describe("One-sentence summary of what was delegated, in plain English."),
  schedule: z
    .enum(["once", "recurring"])
    .optional()
    .describe(
      "'once' (default). 'recurring' is not supported yet — prefer suggesting a Workflow to the user for recurring automations.",
    ),
});

export function buildDelegateTool(scope: BotScope): ToolSet {
  return {
    delegate_task: tool({
      description: [
        "Hand off a task that doesn't fit this single turn to the property's durable agent runtime. Use when the user wants something long-running or multi-step that should proceed after you reply:",
        "- investigate-and-report jobs (dig through bookings/tasks/docs and produce a summary)",
        "- multi-step operations that may need human approval mid-way",
        "DON'T use this for questions you can answer right now, and don't promise ongoing monitoring or recurring runs — for recurring automations, point the user at Workflows.",
        "The user sees your instant reply confirming the delegation; the work continues durably in the background.",
      ].join(" "),
      inputSchema: DelegateInput,
      execute: async ({ brief, summary, schedule }) => {
        if (schedule === "recurring") {
          return {
            delegated: false,
            reason:
              "Recurring delegation isn't supported. Suggest the user create a Workflow (Workflows section) for recurring automations.",
          };
        }
        const result = await delegateToEve({
          propertyId: scope.propertyId,
          userId: scope.userId,
          brief,
        });
        if (!result.ok) {
          return {
            delegated: false,
            reason: `The agent runtime is unavailable (${result.reason}). Tell the user the task could not be delegated right now.`,
          };
        }
        console.log("[delegate-task]", {
          propertyId: scope.propertyId,
          surface: scope.surface,
          sessionId: result.sessionId,
          summary,
        });
        return {
          delegated: true,
          sessionId: result.sessionId,
          note: "Task handed to the durable agent. It proceeds in the background; results land in the app (tasks/notifications) per the brief.",
          summary,
        };
      },
    }),
  };
}
