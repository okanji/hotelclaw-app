"use client";

import { useEffect, useMemo, useState } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Check, Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { QuickAccessRow } from "./quick-access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  tasksQueryOptions,
  propertyMembersQueryOptions,
} from "@/lib/query/section-queries";
import { pendingBookingsCountQueryOptions } from "@/lib/query/booking-queries";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { useNotifications } from "@/components/shell/use-notifications";
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_IDS,
  WIDGETS_BY_ID,
} from "./dashboard-registry";
import { useDashboardLayout } from "./use-dashboard-layout";
import Link from "next/link";
import { CustomizeMenu, HiddenTray } from "./editorial-section";
import { DocumentSection, SectionHeading } from "./document-section";
import {
  DashboardFilterMenu,
  DashboardFilterProvider,
  type DashboardFilter,
} from "./dashboard-filter";
import {
  asHomeRole,
  DASHBOARD_PRESETS,
  heroFor,
  roleWeightedOrder,
  type HomeLens,
  type HomeRole,
} from "./role-order";
import { ShiftBriefWidget } from "./widgets/shift-brief-widget";
import { AttentionWidget } from "./widgets/attention-widget";
import { IntelligenceBriefWidget } from "./widgets/intelligence-brief-widget";

/**
 * Property "Home" — a role-adaptive **home document**, not a dashboard.
 *
 * Structure (notion-spec-v2 §3): the whole page is the 720px `max-w-content`
 * column. It opens the way a Notion page opens — a 40px/48px weight-700 title,
 * one 14px muted line, and then content. There is deliberately **no boxed KPI
 * strip under the title**: the role-tuned numbers are a single quiet inline
 * metrics line (12px faint labels beside 24px weight-600 tabular values,
 * separated by whitespace, no card chrome), because they are heterogeneous
 * signals that each belong to a *different* section below — folding them into
 * those sections would scatter the at-a-glance read that the role weighting
 * exists to give. The only page-like cards are the four quick-access
 * destinations, which really are pages.
 *
 * Below the masthead the page is a stack of **document sections** — a 24px
 * weight-600 heading, a 12px faint caption, then the content, separated by
 * whitespace — instead of the old two-column masonry of bordered tiles. The
 * per-user reorder/hide arrangement survives untouched: the grip just moved to
 * the block gutter to the left of the column (see `DocumentSection`).
 *
 * Role still drives the ordering: one widget registry, re-weighted by the
 * viewer's property role — the metrics line, the single promoted "today"
 * section, and the stack's first-render order all key off whether you're an
 * owner, a manager, or staff. The role seed only changes what you START with;
 * the saved on-device arrangement wins, and an unknown role degrades to the
 * persona-blind registry default. The personal activity feed lives in the
 * second sidebar (HomeSection).
 */
export function HomeView({
  propertyId,
  userId,
  userName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
  propertyName: string;
}) {
  const [filter, setFilter] = useState<DashboardFilter>({ kind: "all" });
  const greeting = useGreeting(userName);

  // Role drives the lens. `viewAs` lets an owner/manager preview another
  // persona's Home; it never changes data scope (the APIs stay role-shaped) —
  // only the ordering + hero + masthead copy.
  const { data: members } = useQuery(propertyMembersQueryOptions(propertyId));
  const realRole = useMemo<HomeRole | null>(
    () => asHomeRole(members?.find((m) => m.id === userId)?.role),
    [members, userId],
  );
  const [viewAs, setViewAs] = useState<HomeRole | null>(null);
  // C5 — true impersonation (owner only): pick a member, Home renders THEIR
  // view. Display-only: every query the impersonated view makes is one the
  // owner is already allowed to read (property-scoped RLS); any ACTION still
  // executes as the owner. Widgets whose data is personal-RLS or derived
  // from the session user server-side are hidden (allowlist below) instead
  // of silently showing the owner's own data mislabeled.
  const [viewAsUser, setViewAsUser] = useState<{
    id: string;
    name: string;
    role: HomeRole;
  } | null>(null);
  const role: HomeLens = viewAsUser?.role ?? viewAs ?? realRole;
  const effectiveUserId = viewAsUser?.id ?? userId;

  const {
    order,
    visible,
    hidden,
    isHidden,
    setOrder,
    toggleHidden,
    reset,
    applyLayout,
  } = useDashboardLayout(
      propertyId,
      userId,
      DASHBOARD_WIDGET_IDS,
      "home-layout",
      roleWeightedOrder(role),
    );

  const summary = usePersonalSummary(propertyId, effectiveUserId);
  const metrics = useHomeMetrics(role, summary, propertyId);

  // The one signal lifted out of the masonry into the "Today" hero for this
  // lens. `intelligence` is hero-only (not a registry tile); the others are
  // real widgets filtered out of the grid below so they aren't shown twice.
  const heroId = heroFor(role);
  const showHero =
    heroId !== null &&
    (heroId === "intelligence" || !isHidden(heroId)) &&
    !(viewAsUser && !IMPERSONATION_SAFE_WIDGETS.has(heroId));
  const hero = heroId ? HERO_META[heroId] : null;
  const gridIds = visible.filter(
    (id) =>
      id !== heroId &&
      (!viewAsUser || IMPERSONATION_SAFE_WIDGETS.has(id)),
  );

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

  return (
    <DashboardFilterProvider value={filter}>
    {/* The scroll box keeps ≥32px of horizontal padding at every width so the
        block-gutter grips (−28px) live inside it and never widen the page. */}
    <div className="h-full w-full overflow-y-auto px-8 pt-8 pb-24 sm:px-14 sm:pt-10">
      <div className="mx-auto flex w-full max-w-content flex-col">
        {/* Page controls sit above the title in their own quiet row, the way a
            Notion page header does — the title itself stays unencumbered. */}
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
          {realRole ? (
            <ViewAsMenu
              realRole={realRole}
              viewAs={viewAs}
              onChange={(next) => {
                setViewAs(next);
                setViewAsUser(null);
              }}
              members={
                realRole === "owner"
                  ? (members ?? [])
                      .filter((m) => m.id !== userId)
                      .map((m) => ({
                        id: m.id,
                        name: m.name ?? "Unnamed",
                        role: asHomeRole(m.role) ?? "staff",
                      }))
                  : []
              }
              viewAsUser={viewAsUser}
              onChangeUser={(next) => {
                setViewAsUser(next);
                setViewAs(null);
              }}
            />
          ) : null}
          <DashboardFilterMenu
            propertyId={propertyId}
            value={filter}
            onChange={setFilter}
          />
          <CustomizeMenu
            items={DASHBOARD_WIDGETS}
            visibleCount={visible.length}
            isHidden={isHidden}
            onToggle={toggleHidden}
            onReset={reset}
            presets={DASHBOARD_PRESETS}
            onApplyPreset={(presetId) => {
              const preset = DASHBOARD_PRESETS.find(
                (candidate) => candidate.id === presetId,
              );
              if (preset) applyLayout(preset.order, preset.hidden);
            }}
          />
        </div>

        <SectionHeader
          size="page"
          title={greeting}
          description={sublineFor(role)}
        />

        <MetricsLine items={metrics} />

        {viewAsUser ? (
          <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-pill-warning px-3.5 py-2.5 text-sm">
            <Eye className="size-4 shrink-0 text-pill-warning-ink" />
            <span className="text-foreground">
              Viewing as <strong>{viewAsUser.name}</strong> ({ROLE_LABEL[viewAsUser.role]})
            </span>
            <span className="text-xs text-muted-foreground">
              Read-only preview — personal sections (shift brief, notifications)
              are hidden; anything you click still acts as you.
            </span>
            <button
              type="button"
              onClick={() => setViewAsUser(null)}
              className="ml-auto text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              Exit
            </button>
          </div>
        ) : null}

        <div className="mt-10">
          <QuickAccessRow propertyId={propertyId} />
        </div>

        {/* The stack: the promoted "today" section, then every other section,
            separated by whitespace alone (no rules, no cards). */}
        <div className="mt-14 flex flex-col gap-14">
          {showHero && hero ? (
            <section className="min-w-0">
              <SectionHeading title={hero.title} subLabel={hero.kicker} />
              <HeroBody heroId={heroId!} propertyId={propertyId} />
            </section>
          ) : null}

          {gridIds.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-pretty text-muted-foreground">
                {showHero
                  ? "Everything else is hidden — bring a section back from the tray below."
                  : "Every section is hidden — bring one back from the tray below."}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={reset}>
                <RotateCcw className="size-4" />
                Restore default layout
              </Button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={gridIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-14">
                  {gridIds.map((id) => {
                    const def = WIDGETS_BY_ID.get(id);
                    if (!def) return null;
                    const { Component } = def;
                    return (
                      <DocumentSection
                        key={id}
                        id={id}
                        title={def.title}
                        subLabel={def.kicker}
                        onHide={() => toggleHidden(id)}
                      >
                        <Component
                          propertyId={propertyId}
                          userId={effectiveUserId}
                        />
                      </DocumentSection>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <HiddenTray
          items={DASHBOARD_WIDGETS}
          hidden={hidden}
          onRestore={toggleHidden}
        />
      </div>
    </div>
    </DashboardFilterProvider>
  );
}

/* ── Role-tuned masthead copy + number ─────────────────────────────────────── */

const ROLE_LABEL: Record<HomeRole, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

function sublineFor(role: HomeLens): string {
  switch (role) {
    case "owner":
      return "Here's where the property stands today — the analyst's read up top, the rest of the picture below.";
    case "manager":
      return "Here's what needs you to decide today, then the team's momentum and your own work.";
    case "staff":
      return "Here's your shift at a glance — what changed, and what's yours to move.";
    default:
      return "A snapshot of your day and what the team is moving — rearrange it to your liking, or hide what you don't need.";
  }
}

type HomeMetric = {
  label: string;
  value: number;
  href: string;
  /** Draw the value in warning ink while it's non-zero (waiting on a human). */
  attention?: boolean;
};

/**
 * The metrics line — what the 3-across KPI card strip became. Notion never
 * opens a page with boxed stats, so these are plain inline pairs: a 24px
 * weight-600 tabular value beside a 12px faint sentence-case label, items
 * separated by whitespace only. Each pair is still a deep link to its surface.
 */
function MetricsLine({ items }: { items: HomeMetric[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-8 flex flex-wrap items-baseline gap-x-10 gap-y-3">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="group/metric flex items-baseline gap-2 rounded-md focus-visible:shadow-focus"
        >
          <span
            className={cn(
              "text-2xl leading-8 font-semibold tabular-nums",
              item.attention && item.value > 0
                ? "text-pill-warning-ink"
                : "text-foreground",
            )}
          >
            {item.value}
          </span>
          <span className="text-xs leading-3 font-medium text-faint-foreground group-hover/metric:text-muted-foreground">
            {item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Role-tuned headline numbers. Owners lead with the front-desk + risk figures;
 *  everyone else keeps the personal task/unread read. All values come from
 *  queries the sections below already fetch — no new endpoint. */
function useHomeMetrics(
  role: HomeLens,
  summary: { open: number; dueSoon: number; unread: number },
  propertyId: string,
): HomeMetric[] {
  const { data: pendingBookings = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );
  const { data: metrics } = useQuery(insightsMetricsQueryOptions(propertyId));
  const attention = metrics?.attention.length ?? 0;
  const base = `/p/${propertyId}`;

  const unreadMetric: HomeMetric = {
    label: "Unread",
    value: summary.unread,
    href: `${base}/activity`,
  };

  if (role === "owner") {
    return [
      {
        label: "Bookings waiting on a yes",
        value: pendingBookings,
        href: `${base}/bookings?view=pending`,
        attention: true,
      },
      {
        label: "Need attention",
        value: attention,
        href: `${base}/home/insights`,
        attention: true,
      },
      unreadMetric,
    ];
  }
  return [
    {
      label: "Open tasks",
      value: summary.open,
      href: `${base}/tasks`,
    },
    {
      label: "Due within 7 days",
      value: summary.dueSoon,
      href: `${base}/tasks`,
    },
    unreadMetric,
  ];
}

/* ── The promoted "today" section ──────────────────────────────────────────── */

const HERO_META: Record<string, { kicker: string; title: string }> = {
  intelligence: { kicker: "Today · Where things stand", title: "The brief" },
  attention: { kicker: "Today · Needs you", title: "Attention" },
  "shift-brief": { kicker: "Today · Your shift", title: "Shift brief" },
};

function HeroBody({
  heroId,
  propertyId,
}: {
  heroId: string;
  propertyId: string;
}) {
  switch (heroId) {
    case "intelligence":
      return <IntelligenceBriefWidget propertyId={propertyId} />;
    case "attention":
      return <AttentionWidget propertyId={propertyId} />;
    case "shift-brief":
      return <ShiftBriefWidget propertyId={propertyId} />;
    default:
      return null;
  }
}

/** Widgets that are safe to render for an impersonated user: their data is
 *  property-readable and keyed by the userId PROP. Widgets backed by
 *  personal-RLS tables or session-derived APIs (shift brief, morning
 *  check-in, notifications, personal pins, calendar day) would silently show
 *  the OWNER's data — hidden instead. */
const IMPERSONATION_SAFE_WIDGETS = new Set([
  "your-tasks",
  "team",
  "property-pulse",
  "attention",
  "workflow-health",
  "bookings-today",
  "recent-docs",
  "pinned",
]);

/* ── "Viewing as" lens preview ─────────────────────────────────────────────── */

/** Lets an owner/manager preview how Home looks for each role — which signal
 *  leads the "Today" hero and how the sections are ordered. A preview only, NOT
 *  a permission switch: data stays scoped to the real role; just the ordering,
 *  hero, and masthead copy change. */
function ViewAsMenu({
  realRole,
  viewAs,
  onChange,
  members,
  viewAsUser,
  onChangeUser,
}: {
  realRole: HomeRole;
  viewAs: HomeRole | null;
  onChange: (role: HomeRole | null) => void;
  /** Owner only — non-empty enables true per-person impersonation. */
  members: { id: string; name: string; role: HomeRole }[];
  viewAsUser: { id: string; name: string; role: HomeRole } | null;
  onChangeUser: (
    member: { id: string; name: string; role: HomeRole } | null,
  ) => void;
}) {
  const active = viewAs ?? realRole;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant="ghost">
            <Eye className="size-4" />
            <span className="hidden sm:inline">Viewing as </span>
            {viewAsUser ? viewAsUser.name : ROLE_LABEL[active]}
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Preview a role&apos;s Home</DropdownMenuLabel>
          {(["owner", "manager", "staff"] as const).map((r) => (
            <DropdownMenuItem
              key={r}
              onClick={() => onChange(r === realRole ? null : r)}
            >
              <Check
                className={cn(
                  "size-4",
                  active === r ? "opacity-100" : "opacity-0",
                )}
              />
              {ROLE_LABEL[r]}
              {r === realRole ? (
                <span className="text-muted-foreground"> (you)</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {members.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>View as a person</DropdownMenuLabel>
              {members.slice(0, 20).map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() =>
                    onChangeUser(viewAsUser?.id === m.id ? null : m)
                  }
                >
                  <Check
                    className={cn(
                      "size-4",
                      viewAsUser?.id === m.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABEL[m.role]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        {viewAs || viewAsUser ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onChange(null);
                onChangeUser(null);
              }}
            >
              <RotateCcw className="size-4" />
              Back to my view
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Personal summary + greeting ───────────────────────────────────────────── */

/** Personal at-a-glance counts for the header: my open tasks, due-soon, and
 *  unread activity. Cheap client aggregation over already-cached queries. */
function usePersonalSummary(propertyId: string, userId: string) {
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { unseenCount } = useNotifications(userId);

  return useMemo(() => {
    const mineOpen = tasks.filter(
      (t) => t.assignee_id === userId && t.status !== "done",
    );
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const dueSoon = mineOpen.filter(
      (t) => t.due_at && new Date(t.due_at).getTime() <= cutoff,
    ).length;
    return { open: mineOpen.length, dueSoon, unread: unseenCount };
  }, [tasks, userId, unseenCount]);
}

/** Time-of-day greeting; computed in an effect so it's SSR-safe (and pure). */
function useGreeting(name: string | null): string {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    const part =
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const first = name?.trim().split(/\s+/)[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(first ? `${part}, ${first}` : part);
  }, [name]);
  return greeting;
}
