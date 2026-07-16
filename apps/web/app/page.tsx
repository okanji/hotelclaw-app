import { redirect } from "next/navigation";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { createServiceClient } from "@/lib/supabase/server";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Profile gate — set name first.
  if (!(await isOnboarded(user.id))) redirect("/welcome");

  const memberships = await getUserMemberships();
  if (memberships.length === 0) {
    // Invited people who signed up manually (instead of clicking the email
    // button) belong on their invites, not in the create-a-property wizard.
    const email = user.email?.toLowerCase();
    if (email) {
      const service = createServiceClient();
      const { count } = await service
        .from("invites")
        .select("token", { count: "exact", head: true })
        .eq("email", email)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString());
      if ((count ?? 0) > 0) redirect("/invites");
    }
    redirect("/onboarding");
  }
  redirect(`/p/${memberships[0].property_id}/home`);
}
