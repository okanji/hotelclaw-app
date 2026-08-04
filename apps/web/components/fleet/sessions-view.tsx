"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, Workflow } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { SESSION_STATUS_UI } from "@/lib/fleet/status-colors";
import { podBotEmoji } from "@/lib/fleet/tool-catalog";
import { SessionTranscriptSheet } from "./session-transcript";

/** Sessions list — stored columns only (no live stream classification in
 *  the list; the transcript sheet reads the real event log on demand). */
export function SessionsView({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: sessions = [] } = useQuery(
    fleetSessionsQueryOptions(propertyId),
  );
  const openSessionId = params.get("session");
  const openSession =
    sessions.find((s) => s.eve_session_id === openSessionId) ?? null;

  function close() {
    router.replace(pathname);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Sessions"
        description="Every durable conversation and workflow run the pod bots hold in this property. Open one to read its full event log — every message, tool call, and approval, exactly as it happened."
      />

      <hr className="my-10 border-border" />

      {sessions.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No sessions yet">
          Address a bot in a channel (e.g. @frontdesk) or trigger a workflow
          through the actions API and its session will appear here.
        </EmptyState>
      ) : (
        <ul role="list" className="flex flex-col divide-y divide-border">
          {sessions.map((session) => (
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

      <SessionTranscriptSheet
        propertyId={propertyId}
        session={openSession}
        onClose={close}
      />
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
