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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  FolderPlus,
  Home as HomeIcon,
  Plus,
  RotateCcw,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { InviteDialog } from "@/components/shell/invite-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { Gi } from "@/components/gr8r/icon";
import { HomeOverview } from "@/components/gr8r/home-overview";
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
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
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
 * Structure (notion-spec-v2 §3): the whole page is ONE `PageShell` column —
 * `page` (960px), the app-wide default, so the masthead and every section
 * below it share one left edge. (Home was briefly a 720px prose column; its
 * content is list rows with right-aligned metadata, not prose, and those rows
 * read better with the extra measure.) The page chrome is the app-wide
 * compact `PageHeader` ("Home" + the view-as / filter / customize controls);
 * the greeting is page CONTENT at the section tier, then the metrics line,
 * then content. There is deliberately **no boxed KPI
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
  const { greeting, today } = useGreeting(userName);
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

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
  const canManage = realRole === "owner" || realRole === "manager";
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

  const { unseenCount } = useNotifications(effectiveUserId);
  const metrics = useHomeMetrics(role, unseenCount, propertyId);

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
      !GR8R_COVERED.has(id) &&
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
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Home"
        icon={<HomeIcon />}
        actions={
          <div className="flex items-center gap-1.5">
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
              items={STACK_WIDGETS}
              visibleCount={
                visible.filter((id) => !GR8R_COVERED.has(id)).length
              }
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
        }
      />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="page">
        <div className="ph">
          <div>
            <h1>{greeting}</h1>
            <p>
              {today ? <span className="num">{today}</span> : null}
              {today ? " · " : null}
              Here&apos;s what&apos;s happening across your workspace.
            </p>
            <MetricsLine items={metrics} />
          </div>
          <div className="acts">
            {canManage ? (
              <button
                type="button"
                className="btn btn-secondary hide-m"
                onClick={() => setInviteOpen(true)}
              >
                <Gi icon={UserPlus} size={14} />
                Invite member
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary hide-m"
              onClick={() => setProjectOpen(true)}
            >
              <Gi icon={FolderPlus} size={14} />
              New project
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => router.push(`/p/${propertyId}/tasks/new`)}
            >
              <Gi icon={Plus} size={14} />
              New task
            </button>
          </div>
        </div>

        {viewAsUser ? (
          <div
            className="panel row"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              gap: 10,
              flexWrap: "wrap",
              background: "var(--g8-amber-soft)",
            }}
          >
            <Gi icon={Eye} size={15} />
            <span>
              Viewing as <b>{viewAsUser.name}</b> ({ROLE_LABEL[viewAsUser.role]})
            </span>
            <span className="muted" style={{ fontSize: "var(--g8-fs-xs)" }}>
              Read-only preview — personal sections (shift brief, notifications)
              are hidden; anything you click still acts as you.
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ marginLeft: "auto" }}
              onClick={() => setViewAsUser(null)}
            >
              Exit
            </button>
          </div>
        ) : null}

        <HomeOverview propertyId={propertyId} userId={effectiveUserId} />

        {/* Below gr8r's dashboard: the promoted AI "today" panel, then every
            other Home section as a gr8r panel in a reorderable grid. */}
        <div className="stack" style={{ marginTop: 16 }}>
          {showHero && hero ? (
            <section className="panel min-w-0">
              <SectionHeading title={hero.title} subLabel={hero.kicker}>
                <Gi icon={Sparkles} size={14} className="faint" />
              </SectionHeading>
              <div className="panel-b min-w-0">
                <HeroBody heroId={heroId!} propertyId={propertyId} />
              </div>
            </section>
          ) : null}

          <QuickAccessRow propertyId={propertyId} />

          {gridIds.length === 0 ? (
            <div className="panel">
              <div className="empty-state sm">
                <p>
                  {showHero
                    ? "Everything else is hidden — bring a section back from the tray below."
                    : "Every section is hidden — bring one back from the tray below."}
                </p>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={reset}
                >
                  <Gi icon={RotateCcw} size={14} />
                  Restore default layout
                </button>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={gridIds} strategy={rectSortingStrategy}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(min(100%, 380px), 1fr))",
                    gap: 16,
                    alignItems: "start",
                  }}
                >
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
          items={STACK_WIDGETS}
          hidden={hidden}
          onRestore={toggleHidden}
        />
      </div>
    </div>
    </div>
    <InviteDialog
      propertyId={propertyId}
      open={inviteOpen}
      onOpenChange={setInviteOpen}
    />
    <CreateEntityDialog
      open={projectOpen}
      onOpenChange={setProjectOpen}
      propertyId={propertyId}
      kind="project"
    />
    </DashboardFilterProvider>
  );
}

/* ── Role-tuned masthead copy + number ─────────────────────────────────────── */

const ROLE_LABEL: Record<HomeRole, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

type HomeMetric = {
  label: string;
  value: number;
  href: string;
  /** Draw the value in warning ink while it's non-zero (waiting on a human). */
  attention?: boolean;
};

/**
 * The role-tuned signals gr8r's 4-stat strip doesn't carry (insight
 * attention, unread) — a quiet line of links under the
 * page-head subtitle, each a deep link to its surface.
 */
function MetricsLine({ items }: { items: HomeMetric[] }) {
  if (items.length === 0) return null;
  return (
    <p className="row" style={{ flexWrap: "wrap", gap: "2px 14px" }}>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="muted"
          style={{ fontSize: "var(--g8-fs-sm)" }}
        >
          <span
            className="num"
            style={{
              fontWeight: 600,
              color:
                item.attention && item.value > 0
                  ? "var(--g8-amber)"
                  : "var(--g8-text)",
            }}
          >
            {item.value}
          </span>{" "}
          {item.label}
        </Link>
      ))}
    </p>
  );
}

/** Role-tuned extra numbers. Owners get the risk figure beside
 *  unread; everyone else just unread (open / due work is in the stat strip).
 *  All values come from queries the sections below already fetch. */
function useHomeMetrics(
  role: HomeLens,
  unread: number,
  propertyId: string,
): HomeMetric[] {
  const { data: metrics } = useQuery(insightsMetricsQueryOptions(propertyId));
  const attention = metrics?.attention.length ?? 0;
  const base = `/p/${propertyId}`;

  const unreadMetric: HomeMetric = {
    label: "unread",
    value: unread,
    href: `${base}/activity`,
  };

  if (role === "owner") {
    return [
      {
        label: "need attention",
        value: attention,
        href: `${base}/home/insights`,
        attention: true,
      },
      unreadMetric,
    ];
  }
  return [unreadMetric];
}

/** Registry sections gr8r's dashboard above already covers ("My tasks",
 *  "Recent activity") — kept out of the panel grid so they don't render
 *  twice. Their saved hidden/order state is untouched. */
const GR8R_COVERED = new Set(["your-tasks", "workspace-activity"]);
const STACK_WIDGETS = DASHBOARD_WIDGETS.filter((w) => !GR8R_COVERED.has(w.id));

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

/* ── Greeting ──────────────────────────────────────────────────────────────── */

/** Time-of-day greeting + gr8r's "<Weekday>, <Month> <d>" line; computed in an
 *  effect so it's SSR-safe (and pure). */
function useGreeting(name: string | null): { greeting: string; today: string } {
  const [state, setState] = useState({ greeting: "Welcome back", today: "" });
  useEffect(() => {
    const now = new Date();
    const h = now.getHours();
    const part =
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const first = name?.trim().split(/\s+/)[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      greeting: first ? `${part}, ${first}` : part,
      today: now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    });
  }, [name]);
  return state;
}
