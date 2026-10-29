"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  CircleCheck,
  CircleDot,
  Clock,
  Flag,
  HeartPulse,
  Target,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import type { Task } from "@/components/tasks/kanban";
import type { ActivityLogRow } from "@/lib/query/activity-log-queries";
import type { ActivityLookup } from "@/components/activity/activity-log";
import type { PropertyMember } from "@/lib/query/section-queries";
import { isDone } from "@/lib/tasks/statuses";
import { Gi } from "./icon";
import { AvStack } from "./home-glyphs";
import { startOfDay } from "./my-tasks-glyphs";
import { FeedItem, G8Empty, MiniTaskRow, byDue } from "./members-shared";
import { G8Panel } from "./project-page";

/**
 * gr8r's project Overview (src/views/project-overview.js `projOverview`):
 * a `.page` › `.grid2` — About, Progress and Coming up on the left; Details
 * (`dl.kv`), Milestones and Recent activity on the right. Our extra blocks
 * slot in gr8r's style: the catch-up banner + scope stats above the grid,
 * Updates (health calls) beside About, and Details carries lead, teams,
 * initiatives, labels, declared-vs-pace health.
 */
export function ProjectOverview({
  propertyId,
  top,
  about,
  updates,
  progress,
  tasks,
  projectColor,
  memberById,
  details,
  milestones,
  activity,
  activityLookup,
  onSeeList,
  onSeeActivity,
}: {
  propertyId: string;
  /** Catch-up banner + scope stat strip. */
  top?: React.ReactNode;
  about: React.ReactNode;
  updates: React.ReactNode;
  progress: React.ReactNode;
  /** The project's tasks (full rows) for "Coming up". */
  tasks: Task[];
  projectColor: string;
  memberById: Map<string, PropertyMember>;
  details: React.ReactNode;
  milestones: React.ReactNode;
  activity: ActivityLogRow[];
  activityLookup: ActivityLookup;
  onSeeList: () => void;
  onSeeActivity: () => void;
}) {
  const [today] = useState(() => startOfDay(new Date()));
  const soon = useMemo(
    () => tasks.filter((t) => !t.parent_id && !isDone(t) && t.due_at).sort(byDue).slice(0, 6),
    [tasks],
  );

  return (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 22, width: "100%" }}>
      {top ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          {top}
        </div>
      ) : null}
      <div className="grid2">
        <div className="stack">
          <G8Panel title="About">{about}</G8Panel>
          {updates}
          {progress}
          <G8Panel
            title="Coming up"
            flush
            acts={
              <button type="button" className="btn btn-sm btn-ghost" onClick={onSeeList}>
                View list
              </button>
            }
          >
            {soon.length ? (
              soon.map((t) => (
                <MiniTaskRow
                  key={t.id}
                  task={t}
                  propertyId={propertyId}
                  today={today}
                  projectColor={() => projectColor}
                  noProject
                  assignee={t.assignee_id ? (memberById.get(t.assignee_id) ?? null) : null}
                />
              ))
            ) : (
              <G8Empty
                icon={CircleCheck}
                title="Nothing scheduled"
                text="Tasks with due dates will show up here."
                sm
              />
            )}
          </G8Panel>
        </div>

        <div className="stack" style={{ alignSelf: "start" }}>
          <G8Panel title="Details">{details}</G8Panel>
          {milestones}
          <G8Panel
            title="Recent activity"
            acts={
              activity.length ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onSeeActivity}>
                  View all
                </button>
              ) : null
            }
          >
            <div className="feed">
              {activity.length ? (
                activity
                  .slice(0, 6)
                  .map((a) => <FeedItem key={a.id} row={a} lookup={activityLookup} />)
              ) : (
                <span className="faint">No activity yet</span>
              )}
            </div>
          </G8Panel>
        </div>
      </div>
    </div>
  );
}

/** gr8r's `dl.kv` — icon + label, then the value (a `.pillbtn` / picker). */
export function KvRow({
  icon,
  label,
  children,
}: {
  icon: React.ComponentProps<typeof Gi>["icon"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt>
        <Gi icon={icon} size={14} />
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

export const KV_ICONS = {
  status: CircleDot,
  health: HeartPulse,
  lead: User,
  team: Users,
  start: Calendar,
  due: Flag,
  members: UserPlus,
  initiatives: Target,
  created: Clock,
};

/** Members row: the avatar stack of everyone assigned to project work. */
export function MembersValue({
  people,
  propertyId,
}: {
  people: { id: string; name: string | null; avatarUrl: string | null }[];
  propertyId: string;
}) {
  if (people.length === 0) return <span className="pillbtn empty">No one assigned yet</span>;
  return (
    <Link href={`/p/${propertyId}/members`} className="pillbtn" title={people.map((p) => p.name).join(", ")}>
      <AvStack members={people} max={6} />
      <span className="faint">{people.length}</span>
    </Link>
  );
}
