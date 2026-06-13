import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyTasks } from "@/components/tasks/my-tasks";

/**
 * My Tasks — the personal agenda surface (Home rail). Distinct from the
 * /tasks board: grouped by due-horizon with quick actions, not by status.
 * Membership is gated by the property layout; this page only needs the
 * current user's id + first name for the greeting.
 */
export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <MyTasks
      propertyId={propertyId}
      userId={user.id}
      firstName={profile?.full_name ?? null}
    />
  );
}
