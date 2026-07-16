"use server";

import { after } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { upsertStreamUser } from "@/lib/stream/server";

const Schema = z.object({
  fullName: z.string().min(1).max(120),
  // Accounts born from invite/magic links have no password — without one,
  // the recipient is locked out the moment their one-time session ends
  // (this stranded real users twice). The welcome step collects one.
  password: z.string().min(8).max(72).optional(),
});

export async function completeOnboarding(
  input: z.input<typeof Schema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (parsed.data.password) {
    const { error: pwErr } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: { has_password: true },
    });
    if (pwErr) {
      // They already have this exact password (e.g. a pre-flag account
      // re-entering it) — that's fine, just record the flag.
      if (/different from the old/i.test(pwErr.message)) {
        await supabase.auth.updateUser({ data: { has_password: true } });
      } else {
        return { error: pwErr.message };
      }
    }
  }

  const fullName = parsed.data.fullName.trim();
  const onboardedAt = new Date().toISOString();

  // `.select()` so a 0-row match is detectable — a bare update "succeeds"
  // against a missing row, which left users bouncing back to /welcome
  // forever with no visible error.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, onboarded_at: onboardedAt })
    .eq("id", user.id)
    .select("id");

  if (error) return { error: error.message };

  if (!updated || updated.length === 0) {
    // Profile row missing (signup trigger hiccup) — recreate it via the
    // service client rather than stranding the user.
    const service = createServiceClient();
    const { error: insertErr } = await service.from("profiles").insert({
      id: user.id,
      full_name: fullName,
      onboarded_at: onboardedAt,
    });
    if (insertErr) return { error: insertErr.message };
  }

  // Keep Stream's user record in sync so the new name appears in chat.
  // Strictly best-effort and AFTER the response: a slow or misconfigured
  // Stream API must never hang the "Saving…" button or fail onboarding —
  // it did exactly that when this was awaited inline. Chat surfaces
  // re-upsert on token requests, so a miss here self-heals.
  after(async () => {
    try {
      const service = createServiceClient();
      const { data: profile } = await service
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      await upsertStreamUser({
        id: user.id,
        name: fullName,
        image: profile?.avatar_url ?? null,
      });
    } catch (e) {
      console.error("[welcome] Stream user sync failed", e);
    }
  });

  return { ok: true };
}
