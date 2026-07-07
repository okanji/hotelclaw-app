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
import {
  DividerList,
  ROW_CLASS,
  Stats,
  WidgetEmpty,
  relativeShort,
} from "@/components/home/editorial-section";
import { insightsOperationsQueryOptions } from "@/lib/query/insights-queries";
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
  return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;
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
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            {meetings.unownedActionItems} extracted commitment
            {meetings.unownedActionItems === 1 ? " has" : "s have"} no owner —
            they live in{" "}
            <Link
              href={`/p/${propertyId}/meetings`}
              className="underline hover:text-foreground"
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
          <WidgetEmpty>
            Every pinned doc has been touched in the last 60 days.
          </WidgetEmpty>
        ) : (
          <DividerList>
            {staleSops.map((doc) => (
              <li key={doc.documentId}>
                <Link
                  href={`/p/${propertyId}/documents/${doc.documentId}`}
                  className={`${ROW_CLASS} group`}
                >
                  <FileClock className="size-4 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:underline">
                    {doc.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    untouched {relativeShort(doc.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </DividerList>
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
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
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
            <DividerList>
              {automation.topFailing.map((w) => (
                <li key={w.workflowId}>
                  <Link
                    href={`/p/${propertyId}/workflows/${w.workflowId}`}
                    className={`${ROW_CLASS} group`}
                  >
                    <OctagonX className="size-4 shrink-0 text-rose-500" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:underline">
                      {w.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-rose-500">
                      {w.failures} failure{w.failures === 1 ? "" : "s"}
                    </span>
                    {w.lastError ? (
                      <span className="hidden max-w-56 shrink-0 truncate text-xs text-muted-foreground sm:inline">
                        {w.lastError}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </DividerList>
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
      <p className="mt-1.5 text-xs text-muted-foreground">
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
