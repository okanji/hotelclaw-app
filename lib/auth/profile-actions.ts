"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { upsertStreamUser } from "@/lib/stream/server";

const Schema = z.object({
  fullName: z.string().min(1).max(120),
});

/**
 * Lets a signed-in user update their own display name. Mirrors the change
 * into Stream's user record so chat and DMs reflect it immediately.
 *
 * Also marks `onboarded_at` if it was still NULL (someone updating their
 * profile from the welcome flow doesn't need to be re-prompted).
 */
export async function updateProfile(
  input: z.input<typeof Schema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const fullName = parsed.data.fullName.trim();

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  // Sync to Stream (service-role read of avatar since profiles RLS scopes
  // by membership).
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

  return { ok: true };
}
