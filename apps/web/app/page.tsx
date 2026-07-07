import { redirect } from "next/navigation";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Profile gate — set name first.
  if (!(await isOnboarded(user.id))) redirect("/welcome");

  const memberships = await getUserMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  redirect(`/p/${memberships[0].property_id}/home`);
}
