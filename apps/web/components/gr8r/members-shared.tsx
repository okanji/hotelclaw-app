"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { Bot, Crown, Zap } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av, PR_NAME, PrIcon, StIcon, memberHue, initialsOf } from "./home-glyphs";
import { dayDiff, relDate } from "./my-tasks-glyphs";
import { updateTask } from "@/components/tasks/actions";
import type { Task } from "@/components/tasks/kanban";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { useTaskStatusOptions } from "@/lib/query/status-queries";
import { isDone } from "@/lib/tasks/statuses";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { ActivityLogRow } from "@/lib/query/activity-log-queries";
import {
  activityTimeAgo,
  describeActivity,
  type ActivityLookup,
} from "@/components/activity/activity-log";
import type { PropertyMember } from "@/lib/query/section-queries";

/**
 * Shared bits for the gr8r Members / Member / Team / Activity ports
 * (src/pages/members.js, src/pages/activity.js, src/components/task-list.js
 * `miniRow` + `actHtml`, src/ui/helpers.js `empty`) over OUR data.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  guest: "Guest",
};
export const ROLE_RANK: Record<string, number> = {
  owner: 0,
  manager: 1,
  staff: 2,
  guest: 3,
};

/** gr8r `.badge` for a membership role — Owner wears the crown, Guest is amber. */
export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={role === "guest" ? "badge amber" : role === "owner" ? "badge violet" : "badge"}>
      {role === "owner" ? <Gi icon={Crown} size={11} /> : null}
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/** gr8r `.av.xl` — the profile header avatar. */
export function AvXl({ member }: { member: PropertyMember }) {
  return (
    <span
      className="av xl"
      style={{ "--g8-c": memberHue(member.id), overflow: "hidden" } as CSSVars}
      aria-label={member.name ?? "Member"}
    >
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatarUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initialsOf(member.name ?? "?")
      )}
    </span>
  );
}

/** gr8r `empty(icon, title, text, btn, cls)`. */
export function G8Empty({
  icon,
  title,
  text,
  sm,
  children,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  sm?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={sm ? "empty-state sm" : "empty-state"}>
      <div className="glyph">
        <Gi icon={icon} size={20} />
      </div>
      <h2 className="es-h">{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

/** `space_members` for every team of the property → spaceId → userIds. */
export function propertySpaceMembersQueryOptions(
  propertyId: string,
  spaceIds: string[],
) {
  const key = [...spaceIds].sort().join(",");
  return {
    queryKey: ["property-space-members", propertyId, key] as const,
    enabled: spaceIds.length > 0,
    queryFn: async (): Promise<Record<string, string[]>> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("space_members")
        .select("space_id, user_id")
        .in("space_id", spaceIds);
      if (error) throw new Error(error.message);
      const out: Record<string, string[]> = {};
      for (const r of (data ?? []) as { space_id: string; user_id: string }[]) {
        (out[r.space_id] ??= []).push(r.user_id);
      }
      return out;
    },
  };
}

/** Sort tasks by due date, undated last (gr8r `sortTasks(ts, {f:'due'})`). */
export function byDue(a: Task, b: Task): number {
  if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
  if (a.due_at) return -1;
  if (b.due_at) return 1;
  return 0;
}

/** gr8r `miniRow` — complete-check, status glyph, title, project, priority, due, (assignee). */
export function MiniTaskRow({
  task: t,
  propertyId,
  today,
  projectColor,
  assignee,
  noProject,
}: {
  task: Task;
  propertyId: string;
  today: number;
  projectColor?: (projectId: string | null | undefined) => string;
  /** Pass the primary assignee to draw gr8r's trailing avatar. */
  assignee?: PropertyMember | null | undefined;
  noProject?: boolean;
}) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const options = useTaskStatusOptions(propertyId, t.list_id);
  const done = isDone(t);
  const n = t.due_at ? dayDiff(t.due_at, today) : null;
  const dueCls = done || n === null ? "" : n < 0 ? "over" : n <= 1 ? "soon" : "";

  async function toggleDone() {
    const target = done
      ? (options.find((o) => o.category === "open") ?? options[0])
      : (options.find((o) => o.category === "closed") ??
        options.find((o) => o.category === "done"));
    if (!target) return;
    const res = await updateTask({ taskId: t.id, status: target.id });
    if ("error" in res) toast.error(res.error);
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }

  return (
    <div
      className={done ? "mini done" : "mini"}
      role="button"
      tabIndex={0}
      onClick={() => openTask(t.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(t.id);
      }}
    >
      <input
        type="checkbox"
        className="check round"
        checked={done}
        aria-label={`Complete ${t.title}`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => void toggleDone()}
      />
      <span title={t.status_name ?? undefined} style={{ display: "inline-flex" }}>
        <StIcon task={t} />
      </span>
      <span className="tt">{t.title}</span>
      {!noProject && t.project_name ? (
        <span className="pj hide-m">
          <span
            className="pdot"
            style={{ "--g8-c": projectColor?.(t.project_id) ?? "var(--g8-gray)" } as CSSVars}
          />
          <span className="trunc">{t.project_name}</span>
        </span>
      ) : null}
      <span title={`${PR_NAME[t.priority ?? "none"]} priority`} style={{ display: "inline-flex" }}>
        <PrIcon priority={t.priority} />
      </span>
      <span style={{ width: 74, textAlign: "right" }} className="hide-m">
        {t.due_at ? (
          <span className={dueCls ? `due ${dueCls}` : "due"}>{relDate(t.due_at, today)}</span>
        ) : null}
      </span>
      {assignee !== undefined ? <Av member={assignee} /> : null}
    </div>
  );
}

/** gr8r `actHtml` — one `.fitem` sentence over our `describeActivity`. */
export function FeedItem({
  row,
  lookup,
  showProject,
}: {
  row: ActivityLogRow;
  lookup: ActivityLookup;
  showProject?: boolean;
}) {
  const desc = describeActivity(row, lookup);
  const Glyph = row.actor_kind === "workflow" ? Zap : row.actor_kind === "ai" ? Bot : desc.Icon;
  return (
    <div className="fitem">
      {desc.actorMember ? (
        <Av member={desc.actorMember} />
      ) : (
        <span className="av sm" style={{ "--g8-c": "var(--g8-gray)" } as CSSVars} aria-hidden="true">
          <Gi icon={Glyph} size={11} />
        </span>
      )}
      <div className="grow">
        <b>{desc.actor}</b> <span className="muted">{desc.verb}</span>{" "}
        {desc.object ? (
          desc.object.href ? (
            <Link href={desc.object.href} className="obj">
              {desc.object.label}
            </Link>
          ) : (
            <span className="obj">{desc.object.label}</span>
          )
        ) : null}
        {desc.extra ? <span className="muted"> {desc.extra}</span> : null}
        {showProject && desc.project && row.entity_kind !== "project" ? (
          <span className="faint">
            {" "}
            in{" "}
            <Link href={`/p/${lookup.propertyId}/projects/${desc.project.id}`}>
              {desc.project.name}
            </Link>
          </span>
        ) : null}
      </div>
      <time dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>
        {activityTimeAgo(row.created_at)}
      </time>
    </div>
  );
}
