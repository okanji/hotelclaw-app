import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const user = await requireUser();
  if (!(await isOnboarded(user.id))) {
    redirect("/welcome?next=/onboarding");
  }

  // `?add=1` = an already-onboarded member intentionally creating an ADDITIONAL
  // property (via the "Add property" entry in the property switcher). Without
  // it, the wizard is the first-run flow, so bounce members who already have a
  // property back to their home instead of showing onboarding again.
  const { add } = await searchParams;
  const addingProperty = add === "1";

  const memberships = await getUserMemberships();
  if (memberships.length > 0 && !addingProperty) {
    redirect(`/p/${memberships[0].property_id}/home`);
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Full-screen takeover — the wizard is its own visual world, no app shell.
  return (
    <OnboardingWizard
      fullName={profile?.full_name ?? null}
      addingProperty={addingProperty}
      returnTo={
        memberships.length > 0
          ? `/p/${memberships[0].property_id}/home`
          : null
      }
    />
  );
}
