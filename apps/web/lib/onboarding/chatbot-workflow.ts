import "server-only";
import { start } from "workflow/api";
import { createServiceClient } from "@/lib/supabase/server";
import { generateChatbotDraft } from "@/lib/chatbots/generate";
import { templateDef } from "@/lib/chatbots/templates";
import type { ChatbotConfig } from "@/lib/chatbots/schema";

/**
 * Onboarding guest-chatbot build — a small durable workflow (Vercel Workflow
 * SDK, same conventions as lib/workflows/durable-runtime.ts).
 *
 * The AI-generative part of "build everything": drafts a property-specific
 * guest chatbot config from the onboarding answers and inserts it as a DRAFT
 * bot (never auto-published — staff review it in the builder, add knowledge,
 * then publish). Durable because the AI call is the slowest, most
 * failure-prone stage of workspace seeding: each step retries in isolation
 * and the build survives the onboarding request ending.
 *
 * Deterministic-fallback discipline (matches lib/onboarding/plan.ts): if the
 * model call fails or the key is missing, the bot is created from the
 * front_desk template with the property name applied, so onboarding never
 * produces a half-built workspace.
 */

export type ChatbotBuildArgs = {
  propertyId: string;
  ownerId: string;
  propertyName: string;
  /** Natural-language bot brief assembled from the onboarding answers. */
  description: string;
};

// ─── Steps (full Node.js access) ─────────────────────────────────────────────

async function resolveChatbotConfig(args: {
  propertyName: string;
  description: string;
}): Promise<{ config: ChatbotConfig; source: "ai" | "template" }> {
  "use step";
  try {
    const { config } = await generateChatbotDraft(args.description);
    return { config, source: "ai" };
  } catch (err) {
    // Model unavailable / invalid output → front_desk template, renamed for
    // the property. Never fail the workflow over generation.
    console.error("[chatbot-workflow] generation failed, using template", err);
    const def = templateDef("front_desk");
    if (!def) throw new Error("front_desk template missing");
    return {
      config: {
        ...def.config,
        appearance: {
          ...def.config.appearance,
          displayName: `${args.propertyName} Front Desk`,
        },
      },
      source: "template",
    };
  }
}

async function insertChatbot(args: {
  propertyId: string;
  ownerId: string;
  name: string;
  config: ChatbotConfig;
}): Promise<string> {
  "use step";
  const service = createServiceClient();
  // Idempotent-ish: a retried step must not leave two onboarding bots behind.
  const { data: existing } = await service
    .from("chatbots")
    .select("id")
    .eq("property_id", args.propertyId)
    .eq("name", args.name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await service
    .from("chatbots")
    .insert({
      property_id: args.propertyId,
      name: args.name,
      template: "custom",
      config: args.config as unknown as Record<string, unknown>,
      created_by: args.ownerId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`chatbot insert failed: ${error?.message ?? "no row"}`);
  }
  return data.id;
}

// ─── The workflow ────────────────────────────────────────────────────────────

export async function buildGuestChatbotWorkflow(
  args: ChatbotBuildArgs,
): Promise<{ chatbotId: string; source: "ai" | "template" }> {
  "use workflow";

  const { config, source } = await resolveChatbotConfig({
    propertyName: args.propertyName,
    description: args.description,
  });

  const chatbotId = await insertChatbot({
    propertyId: args.propertyId,
    ownerId: args.ownerId,
    name: `${args.propertyName} guest chatbot`,
    config,
  });

  return { chatbotId, source };
}

// ─── Public entry — fire-and-forget from createWorkspace ────────────────────

export async function startGuestChatbotBuild(
  args: ChatbotBuildArgs,
): Promise<{ runId: string }> {
  const run = await start(buildGuestChatbotWorkflow, [args]);
  return { runId: run.runId };
}
