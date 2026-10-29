import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isOnboarded, needsPasswordSetup } from "@/lib/auth/onboarding";
import { createServiceClient } from "@/lib/supabase/server";
import { Building2, MailX, UserRound } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { AuthAlert, AuthCardMark, AuthShell } from "@/components/auth/auth-shell";
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
  if (isExpired(invite.expires_at)) {
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

  // gr8r auth card: plate, title, who you're signed in as, then the choice.
  return (
    <AuthShell>
      <div className="auth-card fx-auth">
        <AuthCardMark icon={Building2} />
        <h1>Join {property?.name ?? "this property"}</h1>
        <p className="sub">
          You&apos;ve been invited as{" "}
          <b style={{ color: "var(--g8-text)", textTransform: "capitalize" }}>
            {invite.role}
          </b>
          .
        </p>
        <div className="panel row" style={{ padding: "10px 14px", gap: 10 }}>
          <Gi icon={UserRound} size={15} className="faint" />
          <span className="muted" style={{ fontSize: 13 }}>
            Signed in as{" "}
            <b style={{ color: "var(--g8-text)", fontWeight: 500 }}>
              {user.email}
            </b>
          </span>
        </div>
        {emailMismatch ? (
          <>
            <AuthAlert tone="warn">
              This invite was sent to{" "}
              <b style={{ wordBreak: "break-all" }}>{invite.email}</b>, so it
              can&apos;t be accepted from this account. Sign in with that
              address to join — or, if it isn&apos;t yours, ask whoever invited
              you to re-send it here.
            </AuthAlert>
            {/* Stacked: two full-width choices read as two real options, and
                neither long email address gets squeezed into a row. */}
            <SwitchAccountButton token={token} invitedEmail={invite.email} />
            <RequestAccessButton token={token} myEmail={user.email!} />
          </>
        ) : (
          <AcceptButton token={token} block />
        )}
        <p className="auth-foot">
          <Link href="/" className="link">
            Cancel
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

function ErrorView({ title, message }: { title: string; message: string }) {
  return (
    <AuthShell>
      <div className="auth-card fx-auth">
        <AuthCardMark icon={MailX} color="var(--g8-red)" />
        <h1>{title}</h1>
        <p className="sub">{message}</p>
        <Link href="/" className="btn btn-secondary btn-lg btn-block">
          Back to app
        </Link>
      </div>
    </AuthShell>
  );
}
