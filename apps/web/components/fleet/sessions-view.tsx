"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, Workflow } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { SESSION_STATUS_UI } from "@/lib/fleet/status-colors";
import { podBotEmoji } from "@/lib/fleet/tool-catalog";
import { SessionTranscriptSheet } from "./session-transcript";
import { PageShell } from "@/components/ui/page-shell";

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
    <PageShell className="flex h-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Sessions"
        description="Every durable conversation and workflow run the pod bots hold in this property. Open one to read its full event log — every message, tool call, and approval, exactly as it happened."
      />

      {/* Masthead and content separate by WHITESPACE. The full-width rule
          that used to sit here read as a seam under a 720px document
          column (notion-spec-v2 §1/§3). */}
      <div className="h-10" />

      {sessions.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No sessions yet">
          Address a bot in a channel (e.g. @frontdesk) or trigger a workflow
          through the actions API and its session will appear here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {/* Kind/state filter chips (bookings-agenda pattern) — zero-count
              chips stay (disabled) so the row doesn't reflow as sessions
              change under Realtime. */}
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([value, label]) => {
              const count = sessions.filter((s) =>
                matchesFilter(s, value),
              ).length;
              const empty = value !== "all" && count === 0;
              return (
                <Chip
                  key={value}
                  size="sm"
                  selected={filter === value}
                  disabled={empty}
                  onClick={() => setFilter(value)}
                  className={cn(empty && "opacity-40")}
                >
                  {label}
                  <span className="tabular-nums opacity-70">{count}</span>
                </Chip>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No sessions match this filter.
            </p>
          ) : (
            <ul role="list" className="flex flex-col divide-y divide-border">
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
        </div>
      )}

      <SessionTranscriptSheet
        propertyId={propertyId}
        session={openSession}
        onClose={close}
      />
    </PageShell>
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
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm">
        {isWorkflow ? (
          <Workflow className="size-4 text-muted-foreground" />
        ) : (
          podBotEmoji(session.bot?.bot_id ?? "")
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">
            {session.bot?.display_name ?? "Bot"}
          </span>
          {isWorkflow ? (
            <StatusBadge tone="violet" dot={false}>
              Workflow run
            </StatusBadge>
          ) : null}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {isWorkflow ? session.eve_session_id : session.channel_id}
        </span>
      </span>
      {session.status !== "idle" ? (
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
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
      <li className="flex items-center gap-3 py-3 opacity-60">{content}</li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        replace
        className="flex items-center gap-3 rounded-md py-3 transition-colors hover:bg-accent"
      >
        {content}
      </Link>
    </li>
  );
}
