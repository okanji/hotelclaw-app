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
import { EyeOff, LineChart } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { CustomizeMenu } from "@/components/home/editorial-section";
import { G8Empty } from "@/components/gr8r/members-shared";
import { G8HiddenTray, G8Section, G8SortableSection } from "./g8-insights";
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
import { ReportsView } from "./reports-view";
import { MyWeekView } from "./my-week-view";
import { InsightsAskPanel } from "./insights-ask-panel";
import { InsightsFollowButton } from "./insights-follow-button";
import { ApiAccessButton } from "./api-access-dialog";
import { ScopeSwitcher } from "./scope-switcher";

export type InsightsSubView = "main" | "reports";

/**
 * The Insights section. The page owns both of its axes: the VIEW tab strip
 * (Overview · Work · Operations · Reports) and the LENS picker in the header
 * (`ScopeSwitcher` — property / team / project / person). The sidebar's
 * Insights node lists the same lenses as shortcuts; both write the shared
 * `useInsightsTab` state, so they stay in lockstep and the page works with
 * its sidebar row collapsed. The automatic intelligence brief
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
  const { dashTab, setDashTab, scope, setScope } = useInsightsTab();
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
    ? "Your throughput, your stuck work, and this week's team update."
    : (INSIGHT_TABS.find((t) => t.id === activeTab)?.blurb ?? "");

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <PageHeader title={heading} icon={<LineChart />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide @container" style={{ maxWidth: 1240 }}>
          <div className="ph">
            <div>
              <h1>{heading}</h1>
              {blurb ? <p>{blurb}</p> : null}
            </div>
            {!isStaff ? (
              <div className="acts">
                <ScopeSwitcher
                  propertyId={propertyId}
                  scope={scope}
                  onChange={setScope}
                />
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
              </div>
            ) : null}
          </div>
          {!isStaff ? (
            <div
              className="tabs"
              role="tablist"
              aria-label="Insights views"
              style={{ marginBottom: 16 }}
            >
              {INSIGHT_TABS.filter((t) => !t.propertyOnly || isProperty).map(
                (t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.id}
                    className={activeTab === t.id ? "tab on" : "tab"}
                    title={t.blurb}
                    onClick={() =>
                      t.id === "reports"
                        ? goReports()
                        : goDash(t.id as InsightDashTab)
                    }
                  >
                    {t.label}
                  </button>
                ),
              )}
            </div>
          ) : null}
          {isPending || !data ? (
            <div className="ins-grid">
              <InsightsSkeleton />
            </div>
          ) : data.role === "staff" ? (
            <div className="ins-grid">
              <MyWeekView propertyId={propertyId} data={data} />
            </div>
          ) : isReports ? (
            <div className="ins-grid">
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
                  <div className="ins-grid">
                    {shown.map((id) => {
                      const def = INSIGHT_SECTIONS_BY_ID.get(id);
                      if (!def) return null;
                      const props = { propertyId, metrics: data, scope };
                      return (
                        <G8SortableSection
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
                        </G8SortableSection>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              <G8HiddenTray
                items={availableDefs}
                hidden={hidden.filter((id) => available.has(id))}
                onRestore={toggleHidden}
              />
            </>
          )}
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
    <div className="panel">
      <G8Empty
        icon={EyeOff}
        title={hasHidden ? "Every section is hidden" : "Nothing here yet"}
        text={
          hasHidden
            ? "Every section in this view is hidden."
            : "Nothing to show in this view yet."
        }
      >
        {hasHidden ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReset}>
            Restore hidden sections
          </button>
        ) : null}
      </G8Empty>
    </div>
  );
}

/** Placeholder while the first metrics load — mirrors the panel rhythm so
 *  the page doesn't reflow when data lands. */
function InsightsSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <section key={i} className={i === 0 ? "panel ins-sec wide" : "panel ins-sec"}>
          <div className="panel-h">
            <div className="ins-ttl" style={{ gap: 6 }}>
              <span className="sk" style={{ display: "block", height: 10, width: 64 }} />
              <span className="sk" style={{ display: "block", height: 16, width: 128 }} />
            </div>
          </div>
          <div className="panel-b">
            <div className="sk" style={{ height: i === 0 ? 192 : 128 }} />
          </div>
        </section>
      ))}
    </>
  );
}

/* ── Shared section primitive for insight views ───────────────────────────── */

/** Static (non-sortable) section — a gr8r `.panel`. `wide` spans both
 *  columns of the two-column grid. */
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
    <G8Section kicker={kicker} title={title} headerRight={headerRight} wide={wide}>
      {children}
    </G8Section>
  );
}
