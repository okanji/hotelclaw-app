"use client";

import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Stats, WidgetEmpty } from "@/components/home/editorial-section";
import type { AttentionItem, MyWeek } from "@/lib/insights/metrics";
import { insightReportsQueryOptions } from "@/lib/query/insights-queries";
import { ReportMarkdown } from "./report-markdown";
import {
  AXIS_TICK,
  COLOR,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_CURSOR,
  TOOLTIP_LABEL_STYLE,
} from "./chart-style";
import { InsightSection } from "./insights-view";
import { AttentionList } from "./pulse-view";
import { ShiftBriefWidget } from "@/components/home/widgets/shift-brief-widget";

/**
 * My week — the staff Insights surface. Own throughput, own stuck items.
 * Deliberately personal: workload comparison doesn't exist here (the metrics
 * route never returns peer data to a staff session).
 */
export function MyWeekView({
  propertyId,
  data,
}: {
  propertyId: string;
  data: {
    myWeek: MyWeek;
    attention: AttentionItem[];
  };
}) {
  const { myWeek, attention } = data;
  return (
    <>
      <InsightSection kicker="Since your last shift" title="Shift brief" wide>
        <ShiftBriefWidget propertyId={propertyId} />
      </InsightSection>

      <InsightSection kicker="Your momentum" title="Completed">
        <div className="flex flex-col gap-5">
          <Stats
            items={[
              { label: "completed this week", value: myWeek.doneThisWeek },
              { label: "open", value: myWeek.openTotal },
              {
                label: "overdue",
                value: myWeek.overdueTotal,
                tone: "rose",
              },
            ]}
          />
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={myWeek.doneByWeek}
                margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
              >
                <defs>
                  <linearGradient id="my-week-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR.done} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLOR.done} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  interval="preserveStartEnd"
                />
                <Tooltip
                  cursor={TOOLTIP_CURSOR}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Area
                  type="monotone"
                  dataKey="done"
                  name="Completed"
                  stroke={COLOR.done}
                  strokeWidth={2}
                  fill="url(#my-week-fill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </InsightSection>

      <InsightSection kicker="Yours to unstick" title="Attention">
        <AttentionList propertyId={propertyId} items={attention} />
      </InsightSection>

      <TeamUpdate propertyId={propertyId} />
    </>
  );
}

/** The latest staff-audience weekly update — RLS only ever returns staff
 *  rows to a staff session, so this can't leak the management report. */
function TeamUpdate({ propertyId }: { propertyId: string }) {
  const { data: reports = [] } = useQuery(
    insightReportsQueryOptions(propertyId),
  );
  const latest = reports.find((r) => r.audience === "staff");

  return (
    <InsightSection kicker="AI briefing" title="Team update" wide>
      {!latest ? (
        <WidgetEmpty>
          No team update yet — one is written each week from the same numbers
          shown above.
        </WidgetEmpty>
      ) : (
        <ReportMarkdown>{latest.summary_md}</ReportMarkdown>
      )}
    </InsightSection>
  );
}
