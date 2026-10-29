"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { FileClock, OctagonX } from "lucide-react";
import { relativeShort } from "@/components/home/editorial-section";
import { insightsOperationsQueryOptions } from "@/lib/query/insights-queries";
import { Gi } from "@/components/gr8r/icon";
import { G8InlineStats as Stats, G8Note, G8Rows } from "./g8-insights";
import {
  AXIS_TICK,
  COLOR,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_CURSOR,
  TOOLTIP_LABEL_STYLE,
} from "./chart-style";

/**
 * Operations — the property's machinery: meeting outcomes (the headline
 * metric is action items nobody owns), automation run health, the activity
 * heartbeat, and pinned SOPs going stale. Owners additionally see team
 * composition + the invite funnel. Split into one body per section so each
 * is independently draggable in the insights grid — all of them read the
 * same react-query payload (deduped), so the split costs no extra requests.
 */
function OpsLoading() {
  return (
    <div className="flex flex-col gap-2 py-4" aria-busy="true">
      <span className="sk" style={{ height: 14, width: "60%" }} />
      <span className="sk" style={{ height: 14, width: "40%" }} />
      <span className="sk" style={{ height: 14, width: "50%" }} />
    </div>
  );
}

export function MeetingsBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsOperationsQueryOptions(propertyId));
  if (!data) return <OpsLoading />;
  const { meetings } = data;

  return (
    <>
      <Stats
          items={[
            { label: "meetings", value: meetings.count },
            { label: "hours", value: meetings.totalHours },
            { label: "decisions", value: meetings.decisions },
            { label: "action items", value: meetings.actionItems },
            {
              label: "without an owner",
              value: meetings.unownedActionItems,
              tone: "rose",
            },
          ]}
        />
        {meetings.unownedActionItems > 0 ? (
          <p className="muted" style={{ margin: "12px 0 0", fontSize: "var(--g8-fs-sm)" }}>
            {meetings.unownedActionItems} extracted commitment
            {meetings.unownedActionItems === 1 ? " has" : "s have"} no owner —
            they live in{" "}
            <Link
              href={`/p/${propertyId}/meetings`}
              className="link"
            >
              meeting notes
            </Link>{" "}
            and nowhere else.
          </p>
        ) : null}
    </>
  );
}

export function StaleSopsBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsOperationsQueryOptions(propertyId));
  if (!data) return <OpsLoading />;
  const { staleSops } = data;

  return staleSops.length === 0 ? (
          <G8Note>
            Every pinned doc has been touched in the last 60 days.
          </G8Note>
        ) : (
          <G8Rows>
            {staleSops.map((doc) => (
              <Link
                key={doc.documentId}
                href={`/p/${propertyId}/documents/${doc.documentId}`}
                className="mini"
              >
                <span style={{ color: "var(--g8-amber)", display: "inline-flex" }}>
                  <Gi icon={FileClock} size={14} />
                </span>
                <span className="tt">{doc.title}</span>
                <span className="m">untouched {relativeShort(doc.updatedAt)}</span>
              </Link>
            ))}
          </G8Rows>
        );
}

export function WorkflowRunsBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsOperationsQueryOptions(propertyId));
  if (!data) return <OpsLoading />;
  const { automation } = data;

  return (
    <div className="flex flex-col gap-5">
          <Stats
            items={[
              { label: "succeeded (7d)", value: automation.succeeded },
              { label: "failed", value: automation.failed, tone: "rose" },
              ...(automation.avgDurationSeconds !== null
                ? [{ label: "sec avg duration", value: automation.avgDurationSeconds }]
                : []),
            ]}
          />
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={automation.runsByDay}
                margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
              >
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  interval="preserveStartEnd"
                />
                <Tooltip
                  cursor={{ fill: COLOR.bar, opacity: 0.6 }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Bar
                  dataKey="succeeded"
                  name="Succeeded"
                  stackId="runs"
                  fill={COLOR.series2}
                  radius={[0, 0, 2, 2]}
                />
                <Bar
                  dataKey="failed"
                  name="Failed"
                  stackId="runs"
                  fill={COLOR.danger}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {automation.topFailing.length > 0 ? (
            <G8Rows>
              {automation.topFailing.map((w) => (
                <Link
                  key={w.workflowId}
                  href={`/p/${propertyId}/workflows/${w.workflowId}`}
                  className="mini"
                >
                  <span style={{ color: "var(--g8-red)", display: "inline-flex" }}>
                    <Gi icon={OctagonX} size={14} />
                  </span>
                  <span className="tt">{w.name}</span>
                  <span className="m bad">
                    {w.failures} failure{w.failures === 1 ? "" : "s"}
                  </span>
                  {w.lastError ? (
                    <span className="m trunc hidden sm:inline" style={{ maxWidth: 224 }}>
                      {w.lastError}
                    </span>
                  ) : null}
                </Link>
              ))}
            </G8Rows>
          ) : null}
    </div>
  );
}

export function OpsActivityBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsOperationsQueryOptions(propertyId));
  if (!data) return <OpsLoading />;
  const { eventVolume } = data;

  return (
    <>
      <div className="h-16 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={eventVolume}
              margin={{ top: 2, right: 2, bottom: 0, left: 2 }}
            >
              <defs>
                <linearGradient id="ops-heartbeat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR.series2} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLOR.series2} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={TOOLTIP_CURSOR}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="Events"
                stroke={COLOR.series2}
                strokeWidth={1.5}
                fill="url(#ops-heartbeat)"
              />
              <XAxis dataKey="label" hide />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      <p className="faint" style={{ margin: "6px 0 0", fontSize: "var(--g8-fs-xs)" }}>
        Workspace events per day, last 14 days.
      </p>
    </>
  );
}

export function TeamBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsOperationsQueryOptions(propertyId));
  if (!data) return <OpsLoading />;
  const { team } = data;
  if (!team) return null;

  return (
    <Stats
            items={[
              ...Object.entries(team.roleCounts).map(([role, count]) => ({
                label: role === "staff" ? "staff" : `${role}s`,
                value: count,
              })),
              { label: "pending invites", value: team.pendingInvites },
            ]}
          />
  );
}
