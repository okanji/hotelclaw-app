import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { needsPasswordSetup } from "@/lib/auth/onboarding";
import { safeNextPath } from "@/lib/auth/safe-next";
import { GuestShell } from "@/components/guest/ui";
import { WelcomeForm } from "./welcome-form";
import { SecureAccountForm } from "./secure-account-form";

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

  // Ask invite/magic-link-born accounts to create a password so they can
  // sign back in without an email link — even if they already picked a name
  // (accounts onboarded before this step existed are still passwordless).
  const askPassword = await needsPasswordSetup(user);

  if (profile?.onboarded_at && !askPassword) redirect(next);

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

  // Already named, only missing a password — that's an auth moment, not
  // onboarding: render the /update-password-style card instead of the
  // warm first-run wizard.
  if (profile?.onboarded_at && askPassword) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
        <SecureAccountForm
          fullName={profile.full_name ?? defaultName}
          email={user.email ?? ""}
          next={next}
        />
      </main>
    );
  }

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
