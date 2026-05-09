import { redirect } from "next/navigation";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  await requireUser();
  const memberships = await getUserMemberships();
  if (memberships.length > 0) {
    redirect(`/p/${memberships[0].property_id}/chat`);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <OnboardingForm />
    </main>
  );
}
