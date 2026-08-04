import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isOnboarded, needsPasswordSetup } from "@/lib/auth/onboarding";
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
import {
  AcceptButton,
  RequestAccessButton,
  SwitchAccountButton,
} from "./accept-button";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();

  if (!user) {
    // Magic-link recipients land here already signed-in; this branch only
    // hits if someone visits the link in a different (unauthenticated)
    // browser. Bounce through login → come back here after auth.
    redirect(`/login?next=${encodeURIComponent(`/invites/${token}`)}`);
  }

  // First-time signups set their name — and passwordless accounts create a
  // password — before joining a workspace; the welcome page sends them
  // right back here after.
  if (!(await isOnboarded(user.id)) || (await needsPasswordSetup(user))) {
    redirect(`/welcome?next=${encodeURIComponent(`/invites/${token}`)}`);
  }

  // Look up the invite to surface the property name + role + state.
  // RLS would block the user-scoped client here (they're not yet a member),
  // so we use the service client. This is a public-token lookup — the token
  // itself is the bearer of authorization.
  const service = createServiceClient();
  const { data: invite } = await service
    .from("invites")
    .select(
      "property_id, role, expires_at, accepted_at, email, property:properties!inner(name)",
    )
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return <ErrorView title="Invite not found" message="This invite link is invalid or has been revoked." />;
  }
  if (invite.accepted_at) {
    return (
      <ErrorView
        title="Already used"
        message="This invite has already been accepted. Ask the inviter for a new one if you need to re-join."
      />
    );
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return (
      <ErrorView
        title="Invite expired"
        message="This invite has expired. Ask the inviter to send a fresh one."
      />
    );
  }

  // Type-cast through unknown — Supabase returns the joined property as an
  // array shape in some clients but our select-with-inner gives an object.
  const property = (invite as unknown as { property: { name: string } }).property;
  const emailMismatch =
    user.email && user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join {property?.name ?? "this property"}</CardTitle>
          <CardDescription>
            You've been invited as <span className="font-medium">{invite.role}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
          {emailMismatch ? (
            <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <p>
                This invite was sent to{" "}
                <span className="font-medium break-all">{invite.email}</span>,
                so it can&apos;t be accepted from this account.
              </p>
              <p>
                Sign in with that address to join — or, if it isn&apos;t yours,
                ask whoever invited you to re-send it here.
              </p>
            </div>
          ) : null}
        </CardContent>
        {/* The mismatch case stacks: two full-width choices read as two real
            options, and neither long email address gets squeezed into a row. */}
        <CardFooter
          className={
            emailMismatch
              ? "flex flex-col items-stretch gap-2"
              : "flex justify-between gap-2"
          }
        >
          {emailMismatch ? (
            <>
              <SwitchAccountButton token={token} invitedEmail={invite.email} />
              <RequestAccessButton token={token} myEmail={user.email!} />
              <Button
                variant="ghost"
                nativeButton={false}
                render={<Link href="/" />}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                nativeButton={false}
                render={<Link href="/" />}
              >
                Cancel
              </Button>
              <AcceptButton token={token} />
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}

function ErrorView({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
            Back to app
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
