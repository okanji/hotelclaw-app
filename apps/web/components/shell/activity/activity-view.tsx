"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gr8rInbox, InboxTabs } from "@/components/gr8r/inbox-view";
import { WorkspaceActivity } from "@/components/gr8r/ws-activity-view";
import { viewFromParam } from "./views";

/**
 * Activity main pane. The notification views (`?view=` inbox / unread /
 * mentions / …) render gr8r-studio's two-pane inbox (`Gr8rInbox`); the
 * property-wide "who did what" log (`?view=workspace`, read from
 * `activity_log`) is the Inbox's Activity tab.
 * `?view=triage` (Triage used to be an Inbox tab) redirects to `/triage`,
 * part of Tasks as in Linear.
 */
export function ActivityView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const search = useSearchParams();
  const view = viewFromParam(search.get("view"));

  if (view === "triage") return <TriageRedirect propertyId={propertyId} />;

  if (view !== "workspace") {
    return (
      <Gr8rInbox
        propertyId={propertyId}
        userId={userId}
        view={view}
        unreadParam={search.get("unread") === "1"}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title="Inbox" icon={<Inbox />} />
      <div className="row" style={{ padding: "18px var(--g8-gutter) 0" }}>
        <h1
          style={{
            fontSize: "var(--g8-fs-xl)",
            margin: 0,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          Inbox
        </h1>
      </div>
      <InboxTabs propertyId={propertyId} userId={userId} active="workspace" />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <WorkspaceActivity propertyId={propertyId} meId={userId} />
      </div>
    </div>
  );
}

/** Old `/activity?view=triage[&issue=][&team=]` links → `/triage`. */
function TriageRedirect({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const qs = new URLSearchParams();
    const issue = search.get("issue");
    const team = search.get("team");
    if (issue) qs.set("issue", issue);
    if (team) qs.set("team", team);
    router.replace(`/p/${propertyId}/triage${qs.size ? `?${qs}` : ""}`);
  }, [router, search, propertyId]);
  return null;
}
