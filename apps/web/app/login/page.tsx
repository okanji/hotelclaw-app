import { redirect } from "next/navigation";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);

  const user = await getSessionUser();
  if (user) {
    // Already signed in — honor the destination (e.g. an invite link)
    // instead of dumping them at their first property.
    if (next) redirect(next);
    const memberships = await getUserMemberships();
    if (memberships.length === 0) redirect("/onboarding");
    redirect(`/p/${memberships[0].property_id}/home`);
  }

  // gr8r's auth screen (src/pages/auth.js): the form owns the whole frame
  // because its top-right "Sign up / Log in" switch is the form's own mode.
  return <LoginForm next={next} />;
}
