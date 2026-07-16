import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/safe-next";
import { GuestShell } from "@/components/guest/ui";
import { WelcomeForm } from "./welcome-form";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const next = safeNextPath(sp.next) ?? "/";

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.onboarded_at) redirect(next);

  // Suggest a sensible default — the local-part of their email, title-cased
  // ("jan.l" → "Jan L") — so they can hit Enter without typing if they want.
  const defaultName =
    profile?.full_name ??
    (user.email
      ? user.email
          .split("@")[0]
          .replace(/[._-]+/g, " ")
          .trim()
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : "");

  // Ask invite/magic-link-born accounts to create a password so they can
  // sign back in without an email link. `has_password` is our own metadata
  // flag: set by password signup, /update-password, and this step. OAuth
  // accounts (Google etc.) sign in through their provider and never need
  // one — skip them.
  const isOAuthUser = (user.app_metadata?.providers ?? []).some(
    (p: string) => p !== "email",
  );
  const askPassword = !user.user_metadata?.has_password && !isOAuthUser;

  return (
    <GuestShell>
      <WelcomeForm
        defaultName={defaultName}
        next={next}
        askPassword={askPassword}
      />
    </GuestShell>
  );
}
