import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns true if the current user has completed the welcome step
 * (`profiles.onboarded_at` is set). Used by every entry point into the
 * authenticated app to gate access until the user picks a display name.
 */
export async function isOnboarded(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  return !!data?.onboarded_at;
}

/**
 * True for email-provider accounts that haven't set a password — the
 * invite/magic-link-born accounts that get locked out once their one-time
 * email-link session ends. `has_password` is our own user_metadata flag
 * (set by password signup, password sign-in, /update-password, and the
 * welcome step); it gates UX only, never authorization, so user-editable
 * metadata is fine. OAuth accounts sign in through their provider and
 * never need one.
 *
 * Accounts that predate the flag would all read as passwordless, so we
 * also trust the session itself: a session whose JWT `amr` contains a
 * `password` entry was created by a password sign-in — proof enough. When
 * we see that, backfill the flag so the check is cheap next time.
 */
export async function needsPasswordSetup(user: User): Promise<boolean> {
  const providers: string[] = user.app_metadata?.providers ?? [];
  if (providers.some((p) => p !== "email")) return false;
  if (user.user_metadata?.has_password) return false;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (sessionAmrMethods(session?.access_token).includes("password")) {
    // Idempotent backfill; a failure just means we re-derive from amr
    // next time.
    await supabase.auth.updateUser({ data: { has_password: true } });
    return false;
  }
  return true;
}

/** `amr` methods from a Supabase access token, [] when unreadable. */
function sessionAmrMethods(accessToken: string | undefined): string[] {
  if (!accessToken) return [];
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    ) as { amr?: { method: string }[] };
    return (payload.amr ?? []).map((m) => m.method);
  } catch {
    return [];
  }
}
