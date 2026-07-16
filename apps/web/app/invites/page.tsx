import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { createServiceClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AcceptButton } from "./[token]/accept-button";

/**
 * Pending invites addressed to the signed-in user. This is where `/` sends a
 * member-less account that has invites waiting — without it, an invited
 * person who signed up manually (instead of clicking the email button) was
 * funneled into /onboarding and founded an empty workspace of their own.
 */
export default async function PendingInvitesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=%2Finvites");
  if (!(await isOnboarded(user.id))) redirect("/welcome?next=%2Finvites");

  const email = user.email?.toLowerCase();
  const service = createServiceClient();
  const { data } = email
    ? await service
        .from("invites")
        .select("token, role, expires_at, property:properties!inner(name)")
        .eq("email", email)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };

  const invites = (data ?? []) as unknown as {
    token: string;
    role: string;
    property: { name: string };
  }[];

  const memberships = await getUserMemberships();

  // Nothing pending — send them wherever `/` would.
  if (invites.length === 0) {
    redirect(
      memberships.length > 0
        ? `/p/${memberships[0].property_id}/home`
        : "/onboarding",
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Your invites</CardTitle>
          <CardDescription>
            You've been invited to{" "}
            {invites.length === 1 ? "a property" : `${invites.length} properties`}{" "}
            as <span className="font-medium">{user.email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {invites.map((inv) => (
            <div
              key={inv.token}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {inv.property?.name ?? "Property"}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {inv.role}
                  </p>
                </div>
              </div>
              <AcceptButton token={inv.token} />
            </div>
          ))}
        </CardContent>
        <CardFooter className="justify-between">
          {memberships.length > 0 ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/p/${memberships[0].property_id}/home`} />}
            >
              Back to app
            </Button>
          ) : (
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link href="/onboarding" />}
            >
              Create a new property instead
            </Button>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
