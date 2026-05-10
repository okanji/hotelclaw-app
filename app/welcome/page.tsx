import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { WelcomeForm } from "./welcome-form";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const next = safeNext(sp.next);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.onboarded_at) redirect(next);

  // Suggest a sensible default — the local-part of their email — so they
  // can hit Enter without typing if they want.
  const defaultName =
    profile?.full_name ??
    (user.email ? user.email.split("@")[0].replace(/[._-]+/g, " ") : "");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <WelcomeForm defaultName={defaultName} next={next} />
    </main>
  );
}

/**
 * Only allow same-origin paths in the next param. Otherwise default to /.
 */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}
