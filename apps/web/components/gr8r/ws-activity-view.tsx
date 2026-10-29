"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import {
  groupActivityByDay,
  useActivityLogRealtime,
  useActivityLookup,
} from "@/components/activity/activity-log";
import {
  activityLogQueryOptions,
  matchesFamily,
  type ActivityFamily,
} from "@/lib/query/activity-log-queries";
import type { PropertyMember } from "@/lib/query/section-queries";
import { FeedItem, G8Empty } from "./members-shared";

/**
 * Workspace activity — gr8r-studio's `pageActivity` (src/pages/activity.js),
 * rendered as the Inbox's Activity tab (the Inbox header names the page, so
 * no `.ph` here): `.page` (820 measure) › a kind `.seg` + person `.select`, then
 * `.day-h` buckets of `.feed.lined` `actHtml` rows. Data is our
 * property-wide `activity_log` feed (actor-aware, realtime), with the same
 * kind families (`matchesFamily`) and person filter `ActivityLogFeed` had.
 */

const FAMILIES: { id: ActivityFamily; label: string }[] = [
  { id: "all", label: "All" },
  { id: "status", label: "Status changes" },
  { id: "assignments", label: "Assignments" },
  { id: "dates", label: "Dates" },
  { id: "created", label: "Created" },
  { id: "projects", label: "Projects" },
];

export function WorkspaceActivity({
  propertyId,
  meId,
}: {
  propertyId: string;
  meId: string;
}) {
  const lookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: rows = [], isPending } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "property" }),
  );
  const [family, setFamily] = useState<ActivityFamily>("all");
  const [who, setWho] = useState("all");

  const people = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) if (r.actor_id) ids.add(r.actor_id);
    return [...ids]
      .map((id) => lookup.members.get(id))
      .filter((m): m is PropertyMember => Boolean(m))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [rows, lookup.members]);

  const visible = useMemo(
    () => rows.filter((r) => matchesFamily(r, family) && (who === "all" || r.actor_id === who)),
    [rows, family, who],
  );
  const groups = useMemo(() => groupActivityByDay(visible), [visible]);

  return (
    <div className="page" style={{ maxWidth: 820, paddingTop: 16 }}>
      <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div className="seg" role="group" aria-label="Filter by kind">
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={family === f.id ? "on" : ""}
              aria-pressed={family === f.id}
              onClick={() => setFamily(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {people.length ? (
          <select
            className="select"
            style={{ height: 26, width: "auto", fontSize: 12 }}
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Filter by person"
          >
            <option value="all">Everyone</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === meId ? `${m.name ?? "You"} (you)` : (m.name ?? m.email ?? "Member")}
              </option>
            ))}
          </select>
        ) : null}
        <span className="sp" />
        <span className="faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "change" : "changes"}`
            : `${visible.length} of ${rows.length}`}
        </span>
      </div>

      {isPending && rows.length === 0 ? (
        <div className="faint" style={{ padding: "16px 0" }}>
          Loading…
        </div>
      ) : groups.length === 0 ? (
        <G8Empty
          icon={Activity}
          title={rows.length === 0 ? "No activity yet" : "Nothing matches these filters"}
          text={
            rows.length === 0
              ? "Changes to tasks, projects and milestones will appear here, with who made them."
              : "Try a different kind or person."
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className="day-h">{g.label}</div>
            <div className="feed lined">
              {g.rows.map((r) => (
                <FeedItem key={r.id} row={r} lookup={lookup} showProject />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
