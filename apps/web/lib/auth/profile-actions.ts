"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { upsertStreamUser } from "@/lib/stream/server";

const Schema = z.object({
  fullName: z.string().min(1).max(120),
});

const AVATARS_BUCKET = "avatars";

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

/**
 * Persist a newly uploaded avatar URL (already uploaded directly to Storage
 * from the browser) or clear it. Best-effort deletes the previous file so we
 * don't accumulate orphans in the bucket.
 *
 * Pass `avatarUrl: null` to remove the user's avatar.
 */
export async function updateAvatar(
  avatarUrl: string | null,
): Promise<{ ok: true } | { error: string }> {
  if (avatarUrl !== null) {
    if (typeof avatarUrl !== "string" || avatarUrl.length > 2048) {
      return { error: "Invalid avatar URL" };
    }
    try {
      new URL(avatarUrl);
    } catch {
      return { error: "Invalid avatar URL" };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const service = createServiceClient();
  const { data: existing } = await service
    .from("profiles")
    .select("avatar_url, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const previousUrl = existing?.avatar_url ?? null;

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Best-effort cleanup of the previous file. We only attempt deletion when
  // the URL points at our own bucket and lives under the user's folder — that
  // way we never touch OAuth-provider avatars or files we don't own.
  if (previousUrl && previousUrl !== avatarUrl) {
    const previousPath = extractOwnedAvatarPath(previousUrl, user.id);
    if (previousPath) {
      await service.storage.from(AVATARS_BUCKET).remove([previousPath]);
    }
  }

  await upsertStreamUser({
    id: user.id,
    name: existing?.full_name ?? null,
    image: avatarUrl,
  });

  return { ok: true };
}

const TimeFormatSchema = z.enum(["12h", "24h"]);

export type TimeFormat = z.infer<typeof TimeFormatSchema>;

/** Persists the user's clock-format preference. Stream user record is not
 *  affected — this is a display-only preference for our UI. */
export async function updateTimeFormat(
  format: TimeFormat,
): Promise<{ ok: true } | { error: string }> {
  const parsed = TimeFormatSchema.safeParse(format);
  if (!parsed.success) return { error: "Invalid time format" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ time_format: parsed.data })
    .eq("id", user.id);
  if (error) return { error: error.message };

  return { ok: true };
}

/**
 * If `url` is a public URL for an object in our avatars bucket owned by
 * `userId`, return its storage path (e.g. `<userId>/1715473200000.png`).
 * Returns null for anything else — third-party URLs, mismatched owner, or
 * URLs we can't parse.
 */
function extractOwnedAvatarPath(url: string, userId: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const marker = `/storage/v1/object/public/${AVATARS_BUCKET}/`;
  const idx = parsed.pathname.indexOf(marker);
  if (idx === -1) return null;
  const path = parsed.pathname.slice(idx + marker.length);
  if (!path || !path.startsWith(`${userId}/`)) return null;
  return path;
}
