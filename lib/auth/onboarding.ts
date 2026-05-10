import "server-only";
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
