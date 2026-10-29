import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Mail } from "lucide-react";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded, needsPasswordSetup } from "@/lib/auth/onboarding";
import { createServiceClient } from "@/lib/supabase/server";
import { Gi } from "@/components/gr8r/icon";
import { AuthCardMark, AuthShell } from "@/components/auth/auth-shell";
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
  if (!(await isOnboarded(user.id)) || (await needsPasswordSetup(user))) {
    redirect("/welcome?next=%2Finvites");
  }

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
    <AuthShell>
      <div className="auth-card fx-auth" style={{ maxWidth: 440 }}>
        <AuthCardMark icon={Mail} />
        <h1>Your invites</h1>
        <p className="sub">
          You&apos;ve been invited to{" "}
          {invites.length === 1 ? "a property" : `${invites.length} properties`}{" "}
          as <b style={{ color: "var(--g8-text)" }}>{user.email}</b>.
        </p>
        <div className="panel">
          {invites.map((inv, i) => (
            <div
              key={inv.token}
              className="row"
              style={{
                padding: "12px 14px",
                gap: 12,
                borderTop: i ? "1px solid var(--g8-divider)" : undefined,
              }}
            >
              <span
                className="ftype"
                style={{ "--g8-c": "var(--g8-accent)" } as React.CSSProperties}
              >
                <Gi icon={Building2} size={14} />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inv.property?.name ?? "Property"}
                </div>
                <div
                  className="faint"
                  style={{ fontSize: 12, textTransform: "capitalize" }}
                >
                  {inv.role}
                </div>
              </div>
              <AcceptButton token={inv.token} />
            </div>
          ))}
        </div>
        <p className="auth-foot">
          {memberships.length > 0 ? (
            <Link
              href={`/p/${memberships[0].property_id}/home`}
              className="link"
            >
              Back to app
            </Link>
          ) : (
            <Link href="/onboarding" className="link">
              Create a new property instead
            </Link>
          )}
        </p>
      </div>
    </AuthShell>
  );
}
