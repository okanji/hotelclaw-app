"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CustomizeMenu,
  EditorialSection,
  HiddenTray,
} from "@/components/home/editorial-section";
import { useDashboardLayout } from "@/components/home/use-dashboard-layout";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { useInsightsRealtime } from "@/lib/insights/use-insights-realtime";
import { PROPERTY_SCOPE, type InsightScope } from "@/lib/insights/scope";
import {
  INSIGHT_SECTIONS,
  INSIGHT_SECTIONS_BY_ID,
  INSIGHT_SECTION_IDS,
} from "./insights-registry";
import { ReportsView } from "./reports-view";
import { MyWeekView } from "./my-week-view";
import { ScopeSwitcher } from "./scope-switcher";
import { InsightsAskPanel } from "./insights-ask-panel";
import { InsightsFollowButton } from "./insights-follow-button";
import { ApiAccessButton } from "./api-access-dialog";

export type InsightsSubView = "main" | "reports";

/**
 * The Insights section — one consolidated page with a scope switcher. The
 * automatic intelligence brief leads; the deterministic sections it cites
 * (flow, attention, open work, portfolio, workload) follow in the editorial
 * grid, with a teaser into the separate Reports page at the end. Every
 * section is drag-reorderable and hideable, exactly like the Home dashboard
 * (`INSIGHT_SECTIONS` + `useDashboardLayout`, persisted per user). The whole
 * page — brief included — re-lenses to a project / team (space) / person via
 * the switcher; Operations and the report teaser are property-level and
 * render only on the property scope. Staff get a personal "My week" instead —
 * the metrics endpoint returns the role-appropriate payload and ignores
 * scope params for staff sessions.
 */
export function InsightsView({
  propertyId,
  userId,
  view,
}: {
  propertyId: string;
  userId: string;
  view: InsightsSubView;
}) {
  useInsightsRealtime(propertyId);
  const [scope, setScope] = useState<InsightScope>(PROPERTY_SCOPE);
  const { data, isPending } = useQuery(
    insightsMetricsQueryOptions(propertyId, scope),
  );

  const { order, visible, hidden, isHidden, setOrder, toggleHidden, reset } =
    useDashboardLayout(propertyId, userId, INSIGHT_SECTION_IDS, "insights-layout");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setOrder(arrayMove(order, from, to));
  }

  const isStaff = data?.role === "staff";
  const isProperty = scope.kind === "property";

  // Lens/role gating: filtered-out sections keep their saved position, they
  // just don't render (or appear in the customize menu) for this lens.
  const role = data && data.role !== "staff" ? data.role : null;
  const availableDefs = INSIGHT_SECTIONS.filter(
    (d) =>
      (!d.propertyOnly || isProperty) && (!d.ownerOnly || role === "owner"),
  );
  const available = new Set(availableDefs.map((d) => d.id));
  const shown = visible.filter((id) => available.has(id));
  const showReports = view === "reports" && !isStaff;
  const heading = isStaff ? "My week" : showReports ? "Reports" : "Insights";
  const blurb = isStaff
    ? "Your momentum, your stuck items, and the team's weekly update."
    : showReports
      ? "The AI analyst's weekly briefings — written from the same numbers Insights charts."
      : "The analyst's read first, then every number behind it.";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 pt-12 pb-24 sm:px-14 sm:pt-14">
          <header className="mb-12 flex items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Intelligence
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground">
                {heading}
              </h1>
              <p className="mt-1 max-w-[55ch] text-sm text-pretty text-muted-foreground">
                {blurb}
              </p>
            </div>
            {!isStaff && !showReports ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {role === "owner" ? (
                  <ApiAccessButton propertyId={propertyId} />
                ) : null}
                <InsightsFollowButton propertyId={propertyId} scope={scope} />
                <CustomizeMenu
                  items={availableDefs}
                  visibleCount={shown.length}
                  isHidden={isHidden}
                  onToggle={toggleHidden}
                  onReset={reset}
                />
                <ScopeSwitcher
                  propertyId={propertyId}
                  scope={scope}
                  onChange={setScope}
                />
              </div>
            ) : null}
          </header>

          <div className="@container">
            {isPending || !data ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <InsightsSkeleton />
              </div>
            ) : data.role === "staff" ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <MyWeekView propertyId={propertyId} data={data} />
              </div>
            ) : showReports ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <ReportsView propertyId={propertyId} />
              </div>
            ) : (
              <>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={shown} strategy={rectSortingStrategy}>
                    <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                      {shown.map((id) => {
                        const def = INSIGHT_SECTIONS_BY_ID.get(id);
                        if (!def) return null;
                        const props = { propertyId, metrics: data, scope };
                        return (
                          <EditorialSection
                            key={id}
                            id={id}
                            kicker={def.kicker}
                            title={def.title}
                            wide={def.wide}
                            headerRight={
                              def.HeaderRight ? (
                                <def.HeaderRight {...props} />
                              ) : undefined
                            }
                            onHide={() => toggleHidden(id)}
                          >
                            <def.Component {...props} />
                          </EditorialSection>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
                <HiddenTray
                  items={availableDefs}
                  hidden={hidden.filter((id) => available.has(id))}
                  onRestore={toggleHidden}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {data && data.role !== "staff" && !showReports ? (
        <InsightsAskPanel propertyId={propertyId} scope={scope} />
      ) : null}
    </div>
  );
}

/** Editorial placeholder while the first metrics load — mirrors the section
 *  rhythm (kicker line, heading, hairline, content block) so the page doesn't
 *  reflow when data lands. */
function InsightsSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <section key={i} className={cn("min-w-0", i === 0 && "@4xl:col-span-2")}>
          <div className="mb-6 flex flex-col gap-2 border-b border-border pb-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className={i === 0 ? "h-48 w-full" : "h-32 w-full"} />
        </section>
      ))}
    </>
  );
}

/* ── Shared editorial primitives for insight views ────────────────────────── */

/** Static (non-sortable) editorial section — kicker + heading + hairline.
 *  `wide` spans both columns of the @4xl two-column grid. */
export function InsightSection({
  kicker,
  title,
  headerRight,
  wide = false,
  children,
}: {
  kicker: string;
  title: string;
  headerRight?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0", wide && "@4xl:col-span-2")}>
      <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.625rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {kicker}
          </span>
          <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        </div>
        {headerRight ? (
          <div className="flex shrink-0 items-center gap-2">{headerRight}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
