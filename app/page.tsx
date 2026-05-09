import { redirect } from "next/navigation";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const memberships = await getUserMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  redirect(`/p/${memberships[0].property_id}/chat`);
}
