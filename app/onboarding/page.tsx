import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!(await isOnboarded(user.id))) {
    redirect("/welcome?next=/onboarding");
  }
  const memberships = await getUserMemberships();
  if (memberships.length > 0) {
    redirect(`/p/${memberships[0].property_id}/chat`);
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Full-screen takeover — the wizard is its own visual world, no app shell.
  return <OnboardingWizard fullName={profile?.full_name ?? null} />;
}
