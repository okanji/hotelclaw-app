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

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <LoginForm next={next} />
    </main>
  );
}
