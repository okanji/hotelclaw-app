import { redirect } from "next/navigation";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) {
    const memberships = await getUserMemberships();
    if (memberships.length === 0) redirect("/onboarding");
    redirect(`/p/${memberships[0].property_id}/home`);
  }

  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LoginForm next={sp.next ?? null} />
    </main>
  );
}
