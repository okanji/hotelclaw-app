import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/types";

/**
 * One AI feedback write (migration 0105), shared by the web server action
 * (`components/ai/feedback-actions.ts`) and the bearer route the mobile app
 * calls (`/api/properties/:id/ai-feedback`). Runs as the caller: RLS limits
 * it to their own rows inside properties they belong to. Upserts on the
 * (user, surface, session, message) key so re-clicking flips the rating.
 */
export const AiFeedbackInputSchema = z.object({
  propertyId: z.string().uuid(),
  surface: z.enum(["assistant", "agent", "task", "insights", "document", "channel"]),
  sessionId: z.string().max(200).nullable().optional(),
  messageKey: z.string().min(1).max(200),
  rating: z.union([z.literal(1), z.literal(-1)]),
  note: z.string().trim().max(1000).optional(),
  excerpt: z.string().max(600).optional(),
});
export type AiFeedbackInput = z.infer<typeof AiFeedbackInputSchema>;

export async function upsertAiFeedback(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: AiFeedbackInput,
): Promise<{ ok: true } | { error: string }> {
  const row = {
    property_id: input.propertyId,
    user_id: userId,
    surface: input.surface,
    session_id: input.sessionId ?? null,
    message_key: input.messageKey,
    rating: input.rating,
    note: input.note || null,
    excerpt: input.excerpt?.slice(0, 600) ?? null,
  };
  // The unique index is expression-based (coalesce(session_id,'')), which
  // PostgREST can't target in onConflict — look up, then update or insert.
  let lookup = supabase
    .from("ai_feedback")
    .select("id")
    .eq("user_id", userId)
    .eq("surface", row.surface)
    .eq("message_key", row.message_key);
  lookup =
    row.session_id === null
      ? lookup.is("session_id", null)
      : lookup.eq("session_id", row.session_id);
  const { data: existing } = await lookup.maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("ai_feedback")
      .update({ rating: row.rating, note: row.note, excerpt: row.excerpt })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("ai_feedback").insert(row);
    if (error) return { error: error.message };
  }
  return { ok: true };
}
