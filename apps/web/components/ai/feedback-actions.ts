"use server";

import { createClient } from "@/lib/supabase/server";
import {
  AiFeedbackInputSchema,
  upsertAiFeedback,
  type AiFeedbackInput,
} from "@/lib/ai/feedback";

export type { AiFeedbackInput };

/** Record a thumbs up/down on an AI reply (migration 0105), as the caller. */
export async function recordAiFeedback(
  input: AiFeedbackInput,
): Promise<{ ok: true } | { error: string }> {
  const parsed = AiFeedbackInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid feedback" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  return upsertAiFeedback(supabase, user.id, parsed.data);
}
