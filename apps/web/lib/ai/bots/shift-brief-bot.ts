import "server-only";
/**
 * Shift-brief generator (Tier 1, insights surface). The deterministic
 * gather in `lib/insights/shift-brief.ts` IS the brief — task lists,
 * decisions, one-tap actions all render straight from it. This module only
 * adds the 2–4 sentence Haiku orientation paragraph on top, with the same
 * cost discipline as the intelligence brief: fingerprint short-circuit, a
 * deterministic line for quiet shifts, never caching a failed generation,
 * and a per-instance stampede guard.
 */
import { runBot } from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";
import {
  gatherShiftBrief,
  isEmptyShiftBrief,
  shiftBriefFingerprint,
  type ShiftBriefPayload,
} from "@/lib/insights/shift-brief";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type ShiftBriefRow = {
  property_id: string;
  user_id: string;
  last_seen_at: string;
  payload: ShiftBriefPayload;
  summary_md: string | null;
  fingerprint: string | null;
  generated_at: string | null;
};

const BRIEF_COLUMNS =
  "property_id, user_id, last_seen_at, payload, summary_md, fingerprint, generated_at";

const inFlight = new Set<string>();

export async function getCachedShiftBrief(
  propertyId: string,
  userId: string,
): Promise<ShiftBriefRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("shift_briefs")
    .select(BRIEF_COLUMNS)
    .eq("property_id", propertyId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as ShiftBriefRow | null) ?? null;
}

export async function generateShiftBrief(opts: {
  propertyId: string;
  userId: string;
  role: "owner" | "manager" | "staff";
}): Promise<{ brief: ShiftBriefRow | null; cached: boolean }> {
  const supabase = createServiceClient();
  const flightKey = `${opts.propertyId}:${opts.userId}`;
  if (inFlight.has(flightKey)) {
    return {
      brief: await getCachedShiftBrief(opts.propertyId, opts.userId),
      cached: true,
    };
  }
  inFlight.add(flightKey);
  try {
    const existing = await getCachedShiftBrief(opts.propertyId, opts.userId);
    const since =
      existing?.last_seen_at ??
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const payload = await gatherShiftBrief(
      opts.propertyId,
      opts.userId,
      opts.role,
      since,
    );
    const fingerprint = shiftBriefFingerprint(payload);
    if (existing && existing.fingerprint === fingerprint) {
      return { brief: existing, cached: true };
    }

    let summary: string;
    if (isEmptyShiftBrief(payload)) {
      summary =
        "A quiet stretch — nothing new landed on your plate, no decisions were made, and your teams' boards didn't move since you last looked.";
    } else if (!process.env.ANTHROPIC_API_KEY) {
      return { brief: existing, cached: true };
    } else {
      const result = await runBot({
        persona:
          "You write a 2-4 sentence shift orientation for one person in a hotel/restaurant team workspace: what changed since their last shift and where to start. Every fact comes from the JSON — name the tasks, people, and teams it names; never invent or add numbers of your own. Plain sentences, no headings, no bullets.",
        scopedTools: {},
        modelId: HAIKU_MODEL,
        messages: [
          {
            role: "user",
            content: `Since their last look (${payload.since}):\n${JSON.stringify(payload)}\n\nWrite the orientation paragraph.`,
          },
        ],
        scope: {
          propertyId: opts.propertyId,
          userId: opts.userId,
          surface: "insights",
        },
        responseGuidelines: "Respond with the paragraph only.",
        maxToolSteps: 1,
      });
      // Never cache the apology — the fingerprint would pin it until the
      // facts move again.
      if (!result.ok) {
        return { brief: existing, cached: true };
      }
      summary = result.text.trim();
    }

    const row = {
      property_id: opts.propertyId,
      user_id: opts.userId,
      // last_seen_at intentionally untouched — only "Mark caught up" moves
      // the cursor; regeneration just refreshes the content.
      ...(existing ? {} : { last_seen_at: since }),
      payload,
      summary_md: summary,
      fingerprint,
      generated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("shift_briefs")
      .upsert(row, { onConflict: "property_id,user_id" })
      .select(BRIEF_COLUMNS)
      .single();
    if (error) throw new Error(`failed to save shift brief: ${error.message}`);
    return { brief: saved as ShiftBriefRow, cached: false };
  } finally {
    inFlight.delete(flightKey);
  }
}
