import "server-only";
/**
 * `delegate_to_openclaw` tool — Tier 1 → Tier 2 handoff.
 *
 * In-app bots use this when a user request doesn't fit Tier 1 shape:
 * anything long-running, scheduled, cross-channel, or requiring the
 * OpenClaw Skills ecosystem. The bot's reply might be "Got it — I'll
 * watch #front-desk for the next hour and ping you if I see complaints"
 * while behind the scenes the work goes to OpenClaw.
 *
 * **Current state: stub when no config is resolved.** OpenClaw isn't
 * provisioned yet — the tool stays in the model's tool map so the model
 * learns the delegation pattern, but `execute` records the intended
 * delegation and returns a placeholder. Config is resolved per-property
 * via `resolvePropertyOpenclawConfig(propertyId)` (DB row → env →
 * null); the moment a config exists for a property, the same code path
 * flips to a live HTTP POST against that property's OpenClaw.
 *
 * See AGENTS.md "Two-tier AI architecture" for the design.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { BotScope } from "@/lib/ai/run-bot";
import {
  resolvePropertyOpenclawConfig,
  type OpenclawConfig,
} from "@/lib/ai/openclaw-config";

const DelegateInput = z.object({
  skill: z
    .string()
    .min(1)
    .max(128)
    .describe(
      "OpenClaw skill name to invoke (e.g. 'channel_monitor', 'standup_summary', 'guest_email_followup'). The skill must exist in the OpenClaw registry.",
    ),
  args: z
    .record(z.string(), z.unknown())
    .describe(
      "Arguments to pass to the skill. Shape depends on the skill — pass what the user described.",
    ),
  schedule: z
    .enum(["once", "recurring"])
    .optional()
    .describe(
      "Whether the skill should run once (default) or on a recurring schedule. Pick 'recurring' for tasks the user wants ongoing (monitoring, daily summaries, etc.).",
    ),
  summary: z
    .string()
    .max(280)
    .describe(
      "One-sentence summary of what was delegated, in plain English. Used both for logging and for the model to recall in subsequent conversations.",
    ),
});

export function buildDelegateTool(scope: BotScope): ToolSet {
  return {
    delegate_to_openclaw: tool({
      description: [
        "Hand off a long-running, scheduled, cross-channel, or skill-heavy task to OpenClaw (the persistent agent). Use this when the user wants something that doesn't fit a single turn:",
        "- monitoring a channel for keywords/events over time",
        "- scheduled / recurring tasks (daily summaries, weekly reports, etc.)",
        "- cross-channel automations (route messages from one place to another)",
        "- workflows requiring OpenClaw skills (email send, SMS, calendar manipulation, etc.)",
        "DON'T use this for single-turn questions you can answer immediately. The user sees an instant reply confirming the delegation; the actual work runs in OpenClaw.",
      ].join(" "),
      inputSchema: DelegateInput,
      execute: async ({ skill, args, schedule, summary }) => {
        const cfg = await resolvePropertyOpenclawConfig(scope.propertyId);
        if (!cfg) {
          console.log("[delegate-to-openclaw:stub]", {
            propertyId: scope.propertyId,
            userId: scope.userId,
            surface: scope.surface,
            skill,
            args,
            schedule,
            summary,
          });
          return {
            queued: true,
            stub: true,
            note: "OpenClaw isn't provisioned for this property yet — the delegation was logged. Tell the user the task is queued and will run when OpenClaw is online.",
            skill,
            summary,
          };
        }
        return runLiveDelegation({
          skill,
          args,
          schedule,
          summary,
          scope,
          cfg,
        });
      },
    }),
  };
}

/**
 * Live OpenClaw delegation. Runs only when the resolver returned a config
 * for this property. Until then the stub branch above is used; this stays
 * parked so flipping from stub to live is a config change, not a code change.
 */
async function runLiveDelegation(args: {
  skill: string;
  args: Record<string, unknown>;
  schedule?: "once" | "recurring";
  summary: string;
  scope: BotScope;
  cfg: OpenclawConfig;
}): Promise<unknown> {
  const { url, token } = args.cfg;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        skill: args.skill,
        args: args.args,
        schedule: args.schedule ?? "once",
        summary: args.summary,
        scope: {
          propertyId: args.scope.propertyId,
          userId: args.scope.userId,
          surface: args.scope.surface,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        queued: false,
        error: `OpenClaw returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const body = await res.json().catch(() => ({}));
    return {
      queued: true,
      jobId: (body as { jobId?: string }).jobId,
      skill: args.skill,
      summary: args.summary,
    };
  } catch (err) {
    console.error("[delegate-to-openclaw:live] fetch failed", err);
    return {
      queued: false,
      error: "Couldn't reach OpenClaw — the delegation didn't take. Tell the user to try again or check infrastructure.",
    };
  }
}
