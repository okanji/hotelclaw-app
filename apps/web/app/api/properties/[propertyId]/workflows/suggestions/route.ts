import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Redis } from "@upstash/redis";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { callBrainTool, resolvePropertyBrain } from "@/lib/brain/client";
import { getStep, getTrigger } from "@/lib/workflows/catalog";
import type { StepType, TriggerEventType } from "@/lib/workflows/spec";
import {
  AUTOMATION_FEATURES,
  featureMeta,
  featureStepIds,
  featureTriggerIds,
  type AutomationFeature,
} from "@/lib/workflows/features";
import {
  gatherFeatureSignals,
  signalsDigest,
  type SuggestionSignal,
} from "@/lib/workflows/suggestion-signals";

/**
 * POST /api/properties/:propertyId/workflows/suggestions
 *
 * "What could I automate here?" for one feature, answered from what this
 * property is ACTUALLY doing. Powers the Suggested band of the per-feature
 * Automations modal.
 *
 * Four grounding layers, in order of how much they constrain the answer:
 *
 *  1. **Deterministic signals** (`lib/workflows/suggestion-signals.ts`) — the
 *     real state of this feature's data: 23 overdue tasks, 8 docs untouched in
 *     90 days, a 31% booking cancellation rate. No model computes any of it;
 *     for Tasks these come from the same `computeInsightsMetrics` the
 *     dashboards chart. Each signal has an id the model must CITE in `basis`,
 *     which the route then validates — a suggestion that can't point at real
 *     evidence gets dropped to an empty basis rather than inventing one.
 *  2. **The catalog** — the exact triggers/actions this feature supports, so
 *     the model cannot propose something the engine can't build.
 *  3. **gbrain** — the property's institutional memory. The query is STEERED
 *     BY the top deterministic signals (search "blocked work" only when work
 *     is actually blocked), which makes retrieval pointed instead of generic.
 *     Strictly fail-soft: brainless properties just skip this layer.
 *  4. **Industry prior** — the model's own hospitality-ops knowledge, framed
 *     by the system prompt and disciplined by layers 1–3.
 *
 * The model proposes plain-English GOALS, never specs. The goal goes to the
 * existing author copilot, which owns catalog discovery and validation — so
 * the worst a bad suggestion can do is waste one copilot turn.
 *
 * Cached in Redis for a day against a fingerprint that INCLUDES the signal
 * digest, so suggestions refresh when the property's situation changes, not
 * merely when time passes.
 */

const SUGGEST_MODEL = "claude-haiku-4-5-20251001";
const CACHE_TTL_SECONDS = 60 * 60 * 24;
const MAX_SUGGESTIONS = 4;
/** The modal is waiting on this — a slow brain must not hold the user. */
const BRAIN_TIMEOUT_MS = 6_000;

const Body = z.object({
  feature: z.enum(AUTOMATION_FEATURES as [AutomationFeature, ...AutomationFeature[]]),
  /** Set by the modal's Refresh control — skips the cache read, still writes. */
  refresh: z.boolean().optional(),
});

// Length lives in the DESCRIPTIONS (guidance) and in a server-side clamp —
// deliberately NOT in `.max()` validators. A hard max turns "one sentence ran
// 30 characters long" into a total generation failure: the first live run
// produced three genuinely good, well-cited suggestions and threw all of them
// away across every retry because one `why` was 230 chars against a max of
// 200. Length is a presentation concern; truncate it, don't fail on it.
const Suggestion = z.object({
  title: z
    .string()
    .min(1)
    .describe("Sentence case, at most about 6 words. Names the outcome, not the mechanism."),
  why: z
    .string()
    .min(1)
    .describe(
      "ONE plain sentence (about 25 words) tying this to THIS property's situation — reference the actual number or pattern from the signals where there is one. No jargon.",
    ),
  goal: z
    .string()
    .min(1)
    .describe(
      "The instruction handed to the workflow builder, phrased as 'When X, do Y'. One or two sentences, specific enough to build from.",
    ),
  basis: z
    .array(z.string())
    .max(3)
    .describe(
      "Ids (s1, s2, …) of the deterministic signals this suggestion rests on. Cite genuine inputs only; unknown ids are discarded. Empty if it rests on general practice rather than this property's data.",
    ),
});
const Suggestions = z.object({
  suggestions: z.array(Suggestion).min(1).max(MAX_SUGGESTIONS),
});

export type AutomationSuggestion = Omit<z.infer<typeof Suggestion>, "basis"> & {
  /** Resolved to human-readable evidence lines before it leaves the server. */
  basis: string[];
};

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/** Trim to a display budget on a word boundary. Never fails, never throws. */
function clamp(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** `id — Label: description` lines. This IS the model's menu of the possible. */
function catalogLines(feature: AutomationFeature): { triggers: string; steps: string } {
  const triggers = featureTriggerIds(feature)
    .map((id: TriggerEventType) => {
      const e = getTrigger(id);
      return e ? `- ${e.id} — ${e.label}: ${e.description}` : null;
    })
    .filter(Boolean)
    .join("\n");
  const steps = featureStepIds(feature)
    .map((id: StepType) => {
      const e = getStep(id);
      return e ? `- ${e.id} — ${e.label}: ${e.description}` : null;
    })
    .filter(Boolean)
    .join("\n");
  return { triggers, steps };
}

/**
 * Institutional memory, retrieved with a query built FROM the deterministic
 * signals — so we search what this property is actually struggling with
 * rather than the feature name in the abstract. Fail-soft and time-boxed.
 */
async function brainContext(
  propertyId: string,
  feature: AutomationFeature,
  signals: SuggestionSignal[],
): Promise<string[]> {
  try {
    const binding = await resolvePropertyBrain(propertyId);
    if (!binding) return [];
    const steer = signals
      .slice(0, 3)
      .map((s) => s.evidence)
      .join("; ");
    const query =
      `${featureMeta(feature).label} operations: recurring problems, escalations, standing procedures` +
      (steer ? ` — ${steer}` : "");
    const result = await callBrainTool(
      binding,
      "search",
      { query, limit: 6 },
      { timeoutMs: BRAIN_TIMEOUT_MS },
    );
    if (!result.ok) return [];
    const raw =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content ?? "");
    // The serve returns chunks in varying shapes; we only need readable text
    // for the prompt, so normalize to a bounded string rather than parsing.
    return raw.trim() ? [raw.slice(0, 4000)] : [];
  } catch (err) {
    console.warn("[workflows/suggestions] brain lookup failed", err);
    return [];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { feature } = body;

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error the user needs to see — the modal simply hides the section.
    return NextResponse.json({ suggestions: [], reason: "ai_not_configured" });
  }

  const supabase = await createClient();
  const meta = featureMeta(feature);

  // ── Grounding ────────────────────────────────────────────────────────────
  const [propertyRes, profileRes, teamsRes, labelsRes, workflowsRes, signals] =
    await Promise.all([
      supabase.from("properties").select("name").eq("id", propertyId).maybeSingle(),
      supabase
        .from("property_profiles")
        .select("property_type, team_size, departments, priorities")
        .eq("property_id", propertyId)
        .maybeSingle(),
      supabase
        .from("spaces")
        .select("name")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position")
        .limit(15),
      supabase
        .from("labels")
        .select("name")
        .eq("property_id", propertyId)
        .order("name")
        .limit(25),
      supabase
        .from("workflows")
        .select("name, description")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .limit(100),
      gatherFeatureSignals(propertyId, feature),
    ]);

  const propertyName = propertyRes.data?.name ?? "this property";
  const profile = profileRes.data;
  const teams = (teamsRes.data ?? []).map((t) => t.name);
  const labels = (labelsRes.data ?? []).map((l) => l.name);
  const existing = (workflowsRes.data ?? []).map((w) =>
    w.description ? `${w.name} — ${w.description}` : w.name,
  );

  const { triggers, steps } = catalogLines(feature);
  // Nothing in the catalog for this feature ⇒ nothing honest to suggest.
  if (!triggers && !steps) return NextResponse.json({ suggestions: [] });

  // ── Cache ────────────────────────────────────────────────────────────────
  // The signal digest is in the fingerprint, so the day-long cache still
  // yields to a genuine change in the property's situation.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        feature,
        propertyName,
        profile,
        teams,
        labels,
        existing: existing.slice().sort(),
        signals: signalsDigest(signals),
        v: 2, // bump to invalidate every cached suggestion set after a prompt change
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const cacheKey = `wf-suggest:${propertyId}:${feature}:${fingerprint}`;
  const redis = getRedis();
  if (redis && !body.refresh) {
    try {
      const hit = await redis.get<AutomationSuggestion[]>(cacheKey);
      if (hit && Array.isArray(hit) && hit.length > 0) {
        return NextResponse.json({ suggestions: hit, cached: true });
      }
    } catch (err) {
      console.warn("[workflows/suggestions] cache read failed", err);
    }
  }

  // Only pay for the brain on an actual generation (cache misses).
  const brain = await brainContext(propertyId, feature, signals);

  // ── Generate ─────────────────────────────────────────────────────────────
  const context: string[] = [`Property: ${propertyName}`];
  if (profile?.property_type) context.push(`Type: ${profile.property_type}`);
  if (profile?.team_size) context.push(`Team size: ${profile.team_size}`);
  if (profile?.departments?.length) {
    context.push(`Departments: ${(profile.departments as string[]).join(", ")}`);
  }
  if (profile?.priorities?.length) {
    context.push(`Stated priorities: ${(profile.priorities as string[]).join(", ")}`);
  }
  if (teams.length) context.push(`Teams: ${teams.join(", ")}`);
  if (labels.length) context.push(`Task labels in use: ${labels.join(", ")}`);

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let generated: z.infer<typeof Suggestions>;
  try {
    const result = await generateText({
      model: anthropic(SUGGEST_MODEL),
      output: Output.object({ schema: Suggestions }),
      temperature: 0.4,
      maxRetries: 2,
      system: [
        "You are an operations consultant for hotels and restaurants who knows this software's automation engine inside out.",
        `A manager is looking at the ${meta.label} section and asking "what should I automate here?".`,
        "",
        "How to think:",
        "1. Read the deterministic signals first. They are measured facts about THIS property, not guesses. The best suggestion names a real problem visible in those numbers.",
        "2. Apply hospitality-operations judgement: guest complaints escalate on a clock, blocked work rots silently across shift handovers, unassigned intake is how things get dropped, compliance and safety checks must be provable, and the closing shift should never hand the opening shift a surprise.",
        "3. Check the automation is buildable from the trigger and action catalogs below.",
        "",
        "Rules:",
        `- Every suggestion MUST involve ${meta.label}, either as what starts it or as what it does. It may combine with other surfaces (post to chat, notify a person, create a task).`,
        "- Only use capabilities from the catalogs below. If you cannot express an idea with them, drop the idea.",
        "- Prefer a suggestion anchored to a real signal over a generically sensible one. Cite the signal ids in `basis`. If nothing in the data supports it, leave `basis` empty rather than citing a signal that doesn't say what you claim.",
        "- `why` must be concrete about this property — cite the actual number or pattern where one exists. Never write a sentence that would read identically for any hotel.",
        "- Ground in this property's real nouns (teams, labels, departments, services listed above). Never invent one.",
        "- Do NOT repeat an automation this property already has.",
        "- Write for a busy manager. No template syntax, no step ids, no JSON, no field paths anywhere.",
        "- `goal` is an instruction to a workflow builder: one 'When <event>, <do this>' sentence.",
        `- Return 2 to ${MAX_SUGGESTIONS} suggestions, most valuable first. Fewer sharp ones beat padding.`,
      ].join("\n"),
      prompt: [
        `## Feature: ${meta.label}`,
        meta.blurb,
        "",
        "## This property",
        context.join("\n"),
        "",
        "## Deterministic signals — measured facts (cite ids in `basis`)",
        signals.length
          ? signals.map((s) => `${s.id}: ${s.evidence}`).join("\n")
          : "(no signals available — this surface has little data yet, so lean on standard hospitality practice and keep suggestions foundational)",
        "",
        "## Institutional memory (from this property's knowledge brain)",
        brain.length ? brain.join("\n") : "(nothing relevant found)",
        "",
        `## Triggers available on ${meta.label}`,
        triggers || "(none — this feature can only be acted ON, not listened to)",
        "",
        `## Actions available on ${meta.label}`,
        steps || "(none — this feature can only start workflows)",
        "",
        "## Automations this property already has (do not duplicate)",
        existing.length ? existing.map((e) => `- ${e}`).join("\n") : "(none yet)",
      ].join("\n"),
    });
    generated = result.output;
  } catch (err) {
    console.error("[workflows/suggestions] generation failed", err);
    return NextResponse.json({ suggestions: [], reason: "generation_failed" });
  }

  // Resolve cited ids to the human-readable evidence lines, dropping anything
  // the model invented — what's stored is exactly what the UI shows as
  // provenance, so a hallucinated citation can never reach the user.
  const byId = new Map(signals.map((s) => [s.id, s.evidence]));
  const suggestions: AutomationSuggestion[] = generated.suggestions
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => ({
      ...s,
      title: clamp(s.title, 80),
      why: clamp(s.why, 260),
      goal: clamp(s.goal, 600),
      basis: (s.basis ?? [])
        .map((id) => byId.get(id))
        .filter((e): e is string => Boolean(e))
        .slice(0, 3),
    }));

  if (redis && suggestions.length > 0) {
    try {
      await redis.set(cacheKey, suggestions, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn("[workflows/suggestions] cache write failed", err);
    }
  }
  return NextResponse.json({ suggestions });
}
