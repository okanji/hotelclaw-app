"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Schema = z.object({
  name: z.string().min(1).max(120),
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createProperty(input: {
  name: string;
}): Promise<{ propertyId: string } | { error: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const baseSlug = slugify(parsed.data.name) || "property";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;

  // Onboarding inserts run via the service client: the user just authenticated
  // and is bootstrapping their own workspace. RLS still protects every other
  // path; this is the one elevated entry point.
  const service = createServiceClient();

  const { data: property, error: propErr } = await service
    .from("properties")
    .insert({ name: parsed.data.name, slug })
    .select("id")
    .single();
  if (propErr || !property) {
    return { error: propErr?.message ?? "Failed to create property" };
  }

  const { error: memErr } = await service.from("memberships").insert({
    property_id: property.id,
    user_id: user.id,
    role: "owner",
  });
  if (memErr) {
    // Roll back the orphaned property so the user can retry.
    await service.from("properties").delete().eq("id", property.id);
    return { error: memErr.message };
  }

  return { propertyId: property.id };
}
