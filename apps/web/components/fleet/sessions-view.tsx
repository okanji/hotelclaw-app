"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, Sparkles, Workflow } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/ai-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { SESSION_STATUS_UI } from "@/lib/fleet/status-colors";
import { podBotEmoji } from "@/lib/fleet/tool-catalog";
import { SessionTranscriptSheet } from "./session-transcript";
import { PageHeader } from "@/components/shell/page-header";

type SessionFilter = "all" | "awaiting" | "workflow" | "chat";

const FILTERS: Array<[SessionFilter, string]> = [
  ["all", "All"],
  ["awaiting", "Awaiting approval"],
  ["workflow", "Workflow runs"],
  ["chat", "Chats"],
];

function matchesFilter(session: FleetSessionRow, filter: SessionFilter) {
  switch (filter) {
    case "all":
      return true;
    case "awaiting":
      return session.status === "awaiting_approval";
    case "workflow":
      return session.channel_id.startsWith("workflow:");
    case "chat":
      return !session.channel_id.startsWith("workflow:");
  }
}

/** Sessions list — stored columns only (no live stream classification in
 *  the list; the transcript sheet reads the real event log on demand). */
export function SessionsView({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filter, setFilter] = useState<SessionFilter>("all");
  const { data: sessions = [] } = useQuery(
    fleetSessionsQueryOptions(propertyId),
  );
  const openSessionId = params.get("session");
  const openSession =
    sessions.find((s) => s.eve_session_id === openSessionId) ?? null;
  const filtered = sessions.filter((s) => matchesFilter(s, filter));

  function close() {
    router.replace(pathname);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Agents", href: `/p/${propertyId}/agents`, icon: <Sparkles /> },
          { label: "Sessions" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1100 }}>
          <div className="ph">
            <div>
              <h1>Sessions</h1>
              <p>Pod-bot chats and workflow runs. Open one to read its transcript.</p>
            </div>
          </div>
          {sessions.length === 0 ? (
            <div className="panel">
              <G8Empty
                icon={MessagesSquare}
                title="No sessions yet"
                text="Address a bot in a channel (e.g. @frontdesk) or trigger a workflow through the actions API and its session will appear here."
              />
            </div>
          ) : (
            <>
              {/* Kind/state filter tabs — zero-count tabs stay (disabled) so
                  the row doesn't reflow as sessions change under Realtime. */}
              <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
                {FILTERS.map(([value, label]) => {
                  const count = sessions.filter((s) =>
                    matchesFilter(s, value),
                  ).length;
                  const empty = value !== "all" && count === 0;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={filter === value}
                      disabled={empty}
                      onClick={() => setFilter(value)}
                      className={filter === value ? "tab on" : "tab"}
                      style={empty ? { opacity: 0.4 } : undefined}
                    >
                      {label}
                      <span className="cnt">{count}</span>
                    </button>
                  );
                })}
              </div>

              {filtered.length === 0 ? (
                <div className="panel">
                  <G8Empty sm icon={MessagesSquare} title="Nothing here" text="No sessions match this filter." />
                </div>
              ) : (
                <ul role="list" className="panel" style={{ margin: 0, padding: 0, listStyle: "none", overflow: "hidden" }}>
                  {filtered.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      href={
                        session.eve_session_id
                          ? `${pathname}?session=${encodeURIComponent(session.eve_session_id)}`
                          : null
                      }
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          <SessionTranscriptSheet
            propertyId={propertyId}
            session={openSession}
            onClose={close}
          />
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  href,
}: {
  session: FleetSessionRow;
  href: string | null;
}) {
  const isWorkflow = session.channel_id.startsWith("workflow:");
  const status = SESSION_STATUS_UI[session.status];
  const content = (
    <>
      <span
        className="picon"
        style={{ "--g8-c": isWorkflow ? "var(--g8-violet)" : "var(--g8-gray)", fontSize: 14 } as React.CSSProperties}
      >
        {isWorkflow ? <Gi icon={Workflow} size={14} /> : podBotEmoji(session.bot?.bot_id ?? "")}
      </span>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="row" style={{ gap: 8, fontWeight: 500 }}>
          <span className="trunc">{session.bot?.display_name ?? "Bot"}</span>
          {isWorkflow ? (
            <G8Badge tone="violet" dot={false}>
              Workflow run
            </G8Badge>
          ) : null}
        </span>
        <span className="mono faint trunc" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {isWorkflow ? session.eve_session_id : session.channel_id}
        </span>
      </span>
      {session.status !== "idle" ? (
        <G8Badge tone={status.tone}>{status.label}</G8Badge>
      ) : null}
      <span className="due">
        {session.last_turn_at
          ? new Date(session.last_turn_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </span>
    </>
  );

  if (!href) {
    return (
      <li className="nrow" style={{ alignItems: "center", opacity: 0.6, cursor: "default" }}>
        {content}
      </li>
    );
  }
  return (
    <li className="nrow" style={{ padding: 0 }}>
      <Link
        href={href}
        replace
        className="row grow"
        style={{ gap: 12, padding: "11px 14px", minWidth: 0 }}
      >
        {content}
      </Link>
    </li>
  );
}
