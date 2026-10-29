"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AtSign,
  Calendar,
  ChartGantt,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  FolderOpen,
  Hash,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MessageSquareReply,
  SquareKanban,
  SquarePen,
  Star,
  Workflow,
  LayoutGrid,
  CircleUser,
  TriangleAlert,
  LibraryBig,
  History,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { tintVar } from "@/components/gr8r/ai-glyphs";
import { asTint } from "@/lib/assistant/types";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { documentsTreeQueryOptions, tasksQueryOptions } from "@/lib/query/section-queries";
import {
  assistantChatsQueryOptions,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { isAssignedTo } from "@/lib/tasks/assignees";
import { isDone } from "@/lib/tasks/statuses";
import { InsightsSection } from "./sections/insights-section";
import { useNotifications } from "./use-notifications";
import type { RailMode } from "./app-rail";

/**
 * What a rail item shows while you hover it (user request 2026-10-29): a
 * peek at the section — its top-level places plus the recent things in
 * it — so you can jump straight to a channel, a doc or a conversation
 * without first switching the sidebar. gr8r sidebar markup (`.sitem` rows
 * under `.sgroup-h` heads) inside a `g8 g8-port` popup. Mounted only while
 * the card is open, so the queries here are lazy; most are already warm
 * from the sidebar's prewarm.
 */
export function RailPeek({
  mode,
  propertyId,
  userId,
  isManagement,
}: {
  mode: RailMode;
  propertyId: string;
  userId: string;
  isManagement: boolean;
}) {
  const base = `/p/${propertyId}`;
  switch (mode) {
    case "home":
      return <HomePeek base={base} propertyId={propertyId} userId={userId} />;
    case "chat":
      return <ChatPeek base={base} propertyId={propertyId} />;
    case "docs":
      return <DocsPeek base={base} propertyId={propertyId} />;
    case "assistant":
      return <AssistantPeek base={base} propertyId={propertyId} />;
    case "automations":
      return <AutomationsPeek base={base} propertyId={propertyId} />;
    case "insights":
      return (
        <>
          <Head title="Insights" href={`${base}/home/insights`} />
          <InsightsSection propertyId={propertyId} isManagement={isManagement} />
        </>
      );
  }
}

/** The card's first row: the section name, and "Open" to its root. */
function Head({ title, href }: { title: string; href: string }) {
  return (
    <div className="sgroup-h" style={{ padding: "0 8px", marginBottom: 2 }}>
      <span className="trunc">{title}</span>
      <span className="sp" />
      <Link href={href} className="faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
        Open
      </Link>
    </div>
  );
}

function Row({
  href,
  label,
  icon,
  ct,
  dot,
  lead,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  ct?: number;
  dot?: boolean;
  /** A custom leading glyph (a project's emoji tile) instead of `icon`. */
  lead?: React.ReactNode;
}) {
  return (
    <Link href={href} className="sitem" title={label}>
      {lead ?? (icon ? <Gi icon={icon} /> : null)}
      <span className="trunc">{label}</span>
      {ct ? <span className={dot ? "ct dotc" : "ct"}>{ct > 99 ? "99+" : ct}</span> : null}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sgroup" style={{ marginTop: 8 }}>
      <div className="sgroup-h">
        <span className="trunc">{title}</span>
      </div>
      {children}
    </div>
  );
}

function HomePeek({ base, propertyId, userId }: { base: string; propertyId: string; userId: string }) {
  const { unseenCount } = useNotifications(userId);
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const dueMine = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return tasks.filter(
      (t) => isAssignedTo(t, userId) && !isDone(t) && !!t.due_at && new Date(t.due_at) <= end,
    ).length;
  }, [tasks, userId]);
  return (
    <>
      <Head title="Home" href={`${base}/home`} />
      <Row href={`${base}/activity`} label="Inbox" icon={Inbox} ct={unseenCount} dot />
      <Row href={`${base}/my-tasks`} label="My Tasks" icon={CircleCheck} ct={dueMine} />
      <Row href={`${base}/favorites`} label="Favorites" icon={Star} />
      <Group title="Workspace">
        <Row href={`${base}/overview`} label="Overview" icon={LayoutDashboard} />
        <Row href={`${base}/projects`} label="Projects" icon={FolderKanban} />
        <Row href={`${base}/tasks`} label="Tasks" icon={ListChecks} />
        <Row href={`${base}/calendar`} label="Calendar" icon={Calendar} />
        <Row href={`${base}/timeline`} label="Timeline" icon={ChartGantt} />
      </Group>
    </>
  );
}

/**
 * Chat: Mentions / Replies, then the channels Stream is already watching
 * (`client.activeChannels`, the same map the channel list fills), most
 * recently active first, with their unread counts. Only this property's
 * team channels — their ids carry the `prop-<pid.slice(0,8)>` prefix.
 */
function ChatPeek({ base, propertyId }: { base: string; propertyId: string }) {
  const client = useConnectedStreamClient();
  const prefix = `prop-${propertyId.slice(0, 8)}`;
  const channels = useMemo(() => {
    if (!client) return [];
    return Object.values(client.activeChannels)
      .filter((c) => c.id?.startsWith(prefix) && c.type !== "messaging")
      .sort(
        (a, b) =>
          new Date(b.state.last_message_at ?? 0).getTime() -
          new Date(a.state.last_message_at ?? 0).getTime(),
      )
      .slice(0, 6);
  }, [client, prefix]);
  return (
    <>
      <Head title="Chat" href={`${base}/chat`} />
      <Row href={`${base}/inbox`} label="Mentions" icon={AtSign} />
      <Row href={`${base}/threads`} label="Replies" icon={MessageSquareReply} />
      {channels.length > 0 ? (
        <Group title="Recent channels">
          {channels.map((c) => (
            <Row
              key={c.cid}
              href={`${base}/chat/${c.id}`}
              label={(c.data as { name?: string } | undefined)?.name ?? c.id ?? "Channel"}
              icon={Hash}
              ct={c.countUnread()}
              dot
            />
          ))}
        </Group>
      ) : null}
      <Group title="Direct messages">
        <Row href={`${base}/dms`} label="All messages" icon={MessageSquare} />
      </Group>
    </>
  );
}

const DOC_ICON: Record<string, LucideIcon> = {
  sheet: FileSpreadsheet,
  board: SquareKanban,
};

function DocsPeek({ base, propertyId }: { base: string; propertyId: string }) {
  const { data: docs = [] } = useQuery(documentsTreeQueryOptions(propertyId));
  const recent = useMemo(
    () =>
      [...docs]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 7),
    [docs],
  );
  return (
    <>
      <Head title="Docs" href={`${base}/documents`} />
      <Row href={`${base}/documents`} label="All documents" icon={FolderOpen} />
      {recent.length > 0 ? (
        <Group title="Recently edited">
          {recent.map((d) => (
            <Row
              key={d.id}
              href={`${base}/documents/${d.id}`}
              label={d.title || "Untitled document"}
              icon={DOC_ICON[d.kind] ?? FileText}
            />
          ))}
        </Group>
      ) : null}
    </>
  );
}

function AssistantPeek({ base, propertyId }: { base: string; propertyId: string }) {
  const root = `${base}/assistant`;
  const { data: chats = [] } = useQuery(assistantChatsQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(assistantProjectsQueryOptions(propertyId));
  return (
    <>
      <Head title="AI" href={root} />
      <Row href={root} label="New chat" icon={SquarePen} />
      {projects.length > 0 ? (
        <Group title="Projects">
          {projects.slice(0, 4).map((p) => (
            <Row
              key={p.id}
              href={`${root}/projects/${p.id}`}
              label={p.name}
              lead={
                <span className="pico" style={tintVar(asTint(p.tint))}>
                  <span style={{ fontSize: 10, lineHeight: 1 }}>{p.emoji}</span>
                </span>
              }
            />
          ))}
        </Group>
      ) : null}
      {chats.length > 0 ? (
        <Group title="Recent">
          {chats.slice(0, 6).map((c) => (
            <Row key={c.id} href={`${root}?c=${c.id}`} label={c.title} icon={MessageSquare} />
          ))}
        </Group>
      ) : null}
    </>
  );
}

/**
 * Automations: the saved views, then the most recently run automations
 * (failing ones carry a warning glyph), then Templates / Runs.
 */
function AutomationsPeek({ base, propertyId }: { base: string; propertyId: string }) {
  const root = `${base}/workflows`;
  const { data: workflows = [] } = useQuery(workflowsListQueryOptions(propertyId));
  const failing = workflows.filter((w) => w.enabled && w.last_run_status === "failed").length;
  const recent = useMemo(
    () =>
      [...workflows]
        .sort(
          (a, b) =>
            new Date(b.last_run_at ?? b.updated_at).getTime() -
            new Date(a.last_run_at ?? a.updated_at).getTime(),
        )
        .slice(0, 6),
    [workflows],
  );
  return (
    <>
      <Head title="Automations" href={root} />
      <Row href={root} label="All automations" icon={LayoutGrid} ct={workflows.length} />
      <Row href={`${root}?view=mine`} label="My automations" icon={CircleUser} />
      {failing > 0 ? (
        <Row href={`${root}?view=failing`} label="Failing" icon={TriangleAlert} ct={failing} dot />
      ) : null}
      {recent.length > 0 ? (
        <Group title="Recent">
          {recent.map((w) => (
            <Row
              key={w.id}
              href={`${root}/${w.id}`}
              label={w.name}
              icon={w.enabled && w.last_run_status === "failed" ? TriangleAlert : Workflow}
            />
          ))}
        </Group>
      ) : null}
      <Group title="Library">
        <Row href={`${root}/templates`} label="Templates" icon={LibraryBig} />
        <Row href={`${root}/runs`} label="Runs" icon={History} />
      </Group>
    </>
  );
}
