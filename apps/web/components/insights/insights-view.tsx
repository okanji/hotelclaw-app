"use client";

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
import { SectionHeader } from "@/components/ui/section-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  CustomizeMenu,
  EditorialSection,
  HiddenTray,
} from "@/components/home/editorial-section";
import { useDashboardLayout } from "@/components/home/use-dashboard-layout";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { useInsightsRealtime } from "@/lib/insights/use-insights-realtime";
import {
  INSIGHT_SECTIONS,
  INSIGHT_SECTIONS_BY_ID,
  INSIGHT_SECTION_IDS,
  INSIGHT_TABS,
  type InsightTab,
} from "./insights-registry";
import { useInsightsTab, type InsightDashTab } from "./insights-tab-context";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { ReportsView } from "./reports-view";
import { MyWeekView } from "./my-week-view";
import { InsightsAskPanel } from "./insights-ask-panel";
import { InsightsFollowButton } from "./insights-follow-button";
import { ApiAccessButton } from "./api-access-dialog";

export type InsightsSubView = "main" | "reports";

/**
 * The Insights section — its own rail section, navigated by the views listed in
 * its secondary sidebar (Overview · Work · Operations · Reports, in
 * `InsightsSection`). The active view is shared state (`useInsightsTab`) so the
 * sidebar and this surface stay in lockstep. The automatic intelligence brief
 * leads Overview; the deterministic sections it cites are split across the
 * dashboard views, each drag-reorderable and hideable within its view
 * (`INSIGHT_SECTIONS` + `useDashboardLayout`, persisted per user). Reports keeps
 * its own URL (`/home/insights/reports`) so the notifications and intelligence
 * cards can deep-link straight to it. The whole surface — brief included —
 * re-lenses to a project / team / person via the switcher; Operations and
 * Reports are property-level and only offered on the property scope. Staff get a
 * personal "My week" instead — the metrics endpoint returns the role-appropriate
 * payload and ignores scope params for staff sessions.
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
  // View state (active dashboard tab + lens) is shared with the secondary
  // sidebar that lists the views — see `InsightsTabProvider`. Reports is
  // URL-driven (`view`), so it isn't in the shared state; the pathname wins.
  const { dashTab, setDashTab, scope } = useInsightsTab();
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
  const role = data && data.role !== "staff" ? data.role : null;

  // Reports (URL) always wins; otherwise the shared dashboard tab, falling back
  // to Overview if the current lens doesn't offer it (e.g. Operations while
  // lensed to a project).
  const dashAvailable =
    INSIGHT_TABS.find((t) => t.id === dashTab && (!t.propertyOnly || isProperty)) ??
    null;
  const activeTab: InsightTab =
    view === "reports" && isProperty
      ? "reports"
      : dashAvailable
        ? dashTab
        : "overview";
  const activeMeta = INSIGHT_TABS.find((t) => t.id === activeTab)!;

  // Lens/role gating scoped to the active dashboard tab: filtered-out sections
  // keep their saved position, they just don't render (or appear in the
  // customize menu) for this tab/lens.
  const availableDefs = INSIGHT_SECTIONS.filter(
    (d) =>
      d.tab === activeTab &&
      (!d.propertyOnly || isProperty) &&
      (!d.ownerOnly || role === "owner"),
  );
  const available = new Set(availableDefs.map((d) => d.id));
  const shown = visible.filter((id) => available.has(id));
  const isReports = activeTab === "reports";

  // In-page tab strip navigation (mirrors the old sidebar wiring): dash tabs
  // are shared client state; Reports is a real route so it can be deep-linked.
  const insightsBase = `/p/${propertyId}/home/insights`;
  function goReports() {
    if (isReports) return;
    window.history.pushState(null, "", `${insightsBase}/reports`);
    window.dispatchEvent(new Event("hotelclaw:pathname"));
  }
  function goDash(tab: InsightDashTab) {
    setDashTab(tab);
    if (isReports) {
      window.history.pushState(null, "", insightsBase);
      window.dispatchEvent(new Event("hotelclaw:pathname"));
    }
  }

  const heading = isStaff ? "My week" : "Insights";
  const blurb = isStaff
    ? "Your momentum, your stuck items, and the team's weekly update."
    : activeMeta.blurb;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 pt-12 pb-24 sm:px-14 sm:pt-14">
          <SectionHeader
            size="page"
            className="flex-wrap gap-y-3"
            title={heading}
            description={blurb}
            actions={
              !isStaff ? (
                <>
                  {role === "owner" ? (
                    <ApiAccessButton propertyId={propertyId} />
                  ) : null}
                  <InsightsFollowButton propertyId={propertyId} scope={scope} />
                  {!isReports ? (
                    <CustomizeMenu
                      items={availableDefs}
                      visibleCount={shown.length}
                      isHidden={isHidden}
                      onToggle={toggleHidden}
                      onReset={reset}
                    />
                  ) : null}
                </>
              ) : undefined
            }
          />

          {!isStaff ? (
            <TabNav variant="underline" className="mt-8">
              {INSIGHT_TABS.filter((t) => !t.propertyOnly || isProperty).map(
                (t) => (
                  <TabNavItem
                    key={t.id}
                    active={activeTab === t.id}
                    onClick={() =>
                      t.id === "reports"
                        ? goReports()
                        : goDash(t.id as InsightDashTab)
                    }
                  >
                    {t.label}
                  </TabNavItem>
                ),
              )}
            </TabNav>
          ) : null}

          <div className="mt-10 @container">
            {isPending || !data ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <InsightsSkeleton />
              </div>
            ) : data.role === "staff" ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <MyWeekView propertyId={propertyId} data={data} />
              </div>
            ) : isReports ? (
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-12 gap-y-14 @4xl:grid-cols-2">
                <ReportsView propertyId={propertyId} />
              </div>
            ) : shown.length === 0 ? (
              <TabEmpty
                onReset={reset}
                hasHidden={hidden.some((id) => available.has(id))}
              />
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
      {data && data.role !== "staff" && !isReports ? (
        <InsightsAskPanel propertyId={propertyId} scope={scope} />
      ) : null}
    </div>
  );
}

/** Shown when every section in a dashboard tab has been hidden — offers the
 *  one-tap restore, so a customized-away tab never dead-ends. */
function TabEmpty({
  onReset,
  hasHidden,
}: {
  onReset: () => void;
  hasHidden: boolean;
}) {
  return (
    <div className="col-span-full flex flex-col items-start gap-3 rounded-xl border border-dashed border-border/70 px-6 py-10">
      <p className="text-sm text-muted-foreground">
        {hasHidden
          ? "Every section in this view is hidden."
          : "Nothing to show in this view yet."}
      </p>
      {hasHidden ? (
        <button
          type="button"
          onClick={onReset}
          className="text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
        >
          Restore hidden sections
        </button>
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
          <Eyebrow tone="brand">{kicker}</Eyebrow>
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
