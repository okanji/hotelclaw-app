import "server-only";
/**
 * Catch-up generator (Tier 1) — the per-entity sibling of the shift brief.
 * The deterministic gather IS the content; Haiku adds one orienting
 * sentence. Same cost discipline: fingerprint short-circuit, deterministic
 * text for quiet windows, never cache a failed generation, stampede guard.
 */
import { runBot } from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";
import {
  catchUpFingerprint,
  gatherCatchUp,
  isEmptyCatchUp,
  type CatchUpPayload,
  type CatchUpSubjectKind,
} from "@/lib/insights/catch-up";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type CatchUpRow = {
  property_id: string;
  user_id: string;
  subject_kind: CatchUpSubjectKind;
  subject_id: string;
  last_seen_at: string;
  payload: CatchUpPayload;
  summary_md: string | null;
  fingerprint: string | null;
  generated_at: string | null;
};

const COLUMNS =
  "property_id, user_id, subject_kind, subject_id, last_seen_at, payload, summary_md, fingerprint, generated_at";

const inFlight = new Set<string>();

export async function getCachedCatchUp(
  propertyId: string,
  userId: string,
  subjectKind: CatchUpSubjectKind,
  subjectId: string,
): Promise<CatchUpRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("catch_ups")
    .select(COLUMNS)
    .eq("property_id", propertyId)
    .eq("user_id", userId)
    .eq("subject_kind", subjectKind)
    .eq("subject_id", subjectId)
    .maybeSingle();
  return (data as CatchUpRow | null) ?? null;
}

export async function generateCatchUp(opts: {
  propertyId: string;
  userId: string;
  subjectKind: CatchUpSubjectKind;
  subjectId: string;
  subjectName: string;
}): Promise<{ row: CatchUpRow | null; cached: boolean }> {
  const supabase = createServiceClient();
  const flightKey = `${opts.propertyId}:${opts.userId}:${opts.subjectKind}:${opts.subjectId}`;
  if (inFlight.has(flightKey)) {
    return {
      row: await getCachedCatchUp(
        opts.propertyId,
        opts.userId,
        opts.subjectKind,
        opts.subjectId,
      ),
      cached: true,
    };
  }
  inFlight.add(flightKey);
  try {
    const existing = await getCachedCatchUp(
      opts.propertyId,
      opts.userId,
      opts.subjectKind,
      opts.subjectId,
    );
    const since =
      existing?.last_seen_at ??
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const payload = await gatherCatchUp(
      opts.propertyId,
      opts.userId,
      opts.subjectKind,
      opts.subjectId,
      since,
    );
    const fingerprint = catchUpFingerprint(payload);
    if (existing && existing.fingerprint === fingerprint) {
      return { row: existing, cached: true };
    }

    let summary: string;
    if (isEmptyCatchUp(payload)) {
      summary = "";
    } else if (!process.env.ANTHROPIC_API_KEY) {
      return { row: existing, cached: true };
    } else {
      const result = await runBot({
        persona:
          "You write ONE sentence (two at most) telling someone what changed in a team/project board since they last looked. Every fact comes from the JSON — name the most notable task; never invent. No headings, no bullets.",
        scopedTools: {},
        modelId: HAIKU_MODEL,
        messages: [
          {
            role: "user",
            content: `Changes in "${opts.subjectName}" since ${payload.since}:\n${JSON.stringify(payload)}\n\nWrite the catch-up sentence.`,
          },
        ],
        scope: {
          propertyId: opts.propertyId,
          userId: opts.userId,
          surface: "insights",
        },
        responseGuidelines: "Respond with the sentence only.",
        maxToolSteps: 1,
      });
      if (!result.ok) return { row: existing, cached: true };
      summary = result.text.trim();
    }

    const row = {
      property_id: opts.propertyId,
      user_id: opts.userId,
      subject_kind: opts.subjectKind,
      subject_id: opts.subjectId,
      ...(existing ? {} : { last_seen_at: since }),
      payload,
      summary_md: summary,
      fingerprint,
      generated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("catch_ups")
      .upsert(row, { onConflict: "property_id,user_id,subject_kind,subject_id" })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`failed to save catch-up: ${error.message}`);
    return { row: saved as CatchUpRow, cached: false };
  } finally {
    inFlight.delete(flightKey);
  }
}
