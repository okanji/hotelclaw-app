"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { upsertStreamUser } from "@/lib/stream/server";

const Schema = z.object({
  fullName: z.string().min(1).max(120),
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

  const fullName = parsed.data.fullName.trim();

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, onboarded_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) return { error: error.message };

  // Keep Stream's user record in sync so the new name appears in chat.
  // Service-role for the avatar lookup since profiles RLS only lets users
  // read their own row + property-mates'.
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
