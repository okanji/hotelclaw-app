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
 * (set by password signup, /update-password, and the welcome step); it
 * gates UX only, never authorization, so user-editable metadata is fine.
 * OAuth accounts sign in through their provider and never need one.
 */
export function needsPasswordSetup(user: User): boolean {
  const providers: string[] = user.app_metadata?.providers ?? [];
  const isOAuth = providers.some((p) => p !== "email");
  return !isOAuth && !user.user_metadata?.has_password;
}
