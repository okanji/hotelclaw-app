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
  ArrowUpRight,
  Check,
  Eye,
  FolderPlus,
  Home as HomeIcon,
  Plus,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { InviteDialog } from "@/components/shell/invite-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { Gi } from "@/components/gr8r/icon";
import { HomeStats } from "@/components/gr8r/home-overview";
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
import { DASHBOARD_WIDGETS, WIDGETS_BY_ID } from "./dashboard-registry";
import { useDashboardLayout } from "./use-dashboard-layout";
import Link from "next/link";
import { CustomizeMenu, HiddenTray } from "./editorial-section";
import { DocumentSection } from "./document-section";
import {
  DashboardFilterMenu,
  DashboardFilterProvider,
  type DashboardFilter,
} from "./dashboard-filter";
import {
  asHomeRole,
  DASHBOARD_PRESETS,
  roleWeightedOrder,
  type HomeLens,
  type HomeRole,
} from "./role-order";

/**
 * Property "Home" — a role-adaptive, rearrangeable page.
 *
 * Structure: the app-wide compact `PageHeader` ("Home" + the view-as / filter
 * / customize controls), then gr8r's `.page` column: a greeting masthead
 * (date + the role-tuned metrics on one quiet line, the page actions on the
 * right), the four headline numbers (`HomeStats` — pastel-chipped stat
 * cards, pinned under the masthead because they are the page's at-a-glance
 * read, not a section), then ONE sortable two-column grid holding every
 * section in the registry (`dashboard-registry.tsx`): gr8r's My tasks /
 * Projects / Upcoming deadlines / Recent activity panels and ours (the
 * brief, attention, shift brief, pulse…) alike. Every section is draggable
 * and hideable; `span: "full"` sections take both columns. There is no
 * special "hero" band any more — the role seed simply puts that lens's
 * "today" section first.
 *
 * Role drives the ordering: one registry re-weighted by the viewer's
 * property role (`roleWeightedOrder`). The role seed only changes what you
 * START with; the saved on-device arrangement wins, and an unknown role
 * degrades to the registry default.
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
  // only the ordering + masthead copy.
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

  // The brief is owner/manager content (the metrics endpoint is role-shaped
  // and the widget renders nothing on the staff shape), so the staff lens
  // never lists it.
  const available = useMemo(
    () =>
      DASHBOARD_WIDGETS.filter((w) =>
        role === "staff" ? w.id !== "intelligence" : true,
      ),
    [role],
  );
  const availableIds = useMemo(() => available.map((w) => w.id), [available]);

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
    availableIds,
    // v2 (2026-10-29): the registry gained the gr8r panels, the brief and
    // quick access, and rows gained spans — reseed once from the role default
    // rather than appending five new sections to the end of every saved order.
    "home-layout-v2",
    roleWeightedOrder(role).filter((id) => availableIds.includes(id)),
  );

  const { unseenCount } = useNotifications(effectiveUserId);
  const metrics = useHomeMetrics(role, unseenCount, propertyId);

  const gridIds = visible.filter(
    (id) =>
      availableIds.includes(id) &&
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

  const base = `/p/${propertyId}`;

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
              items={available}
              visibleCount={gridIds.length}
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
      <div className="page home-page">
        <div className="ph home-ph">
          <div>
            <h1>{greeting}</h1>
            <p className="home-sub">
              {today ? <span className="num">{today}</span> : null}
              <MetricsLine items={metrics} />
            </p>
          </div>
          <div className="acts">
            {canManage ? (
              <button
                type="button"
                className="btn btn-secondary hide-m"
                onClick={() => setInviteOpen(true)}
              >
                <Gi icon={UserPlus} size={14} />
                Invite
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
              onClick={() => router.push(`${base}/tasks/new`)}
            >
              <Gi icon={Plus} size={14} />
              New task
            </button>
          </div>
        </div>

        {viewAsUser ? (
          <div className="panel row home-viewas">
            <Gi icon={Eye} size={15} />
            <span>
              Viewing as <b>{viewAsUser.name}</b> ({ROLE_LABEL[viewAsUser.role]})
            </span>
            <span className="muted" style={{ fontSize: "var(--g8-fs-xs)" }}>
              Read-only preview — personal sections are hidden; anything you
              click still acts as you.
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

        <HomeStats propertyId={propertyId} userId={effectiveUserId} />

        <div className="home-body">
          {gridIds.length === 0 ? (
            <div className="panel">
              <div className="empty-state sm">
                <p>Every section is hidden — bring one back from the tray below.</p>
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
                <div className="home-grid">
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
                        icon={def.icon}
                        tone={def.tone}
                        span={def.span}
                        flush={def.flush}
                        onHide={() => toggleHidden(id)}
                        headerRight={
                          def.link ? (
                            <Link
                              href={def.link.href(base)}
                              className="btn btn-sm btn-ghost home-link"
                            >
                              {def.link.label}
                              <Gi icon={ArrowUpRight} size={13} />
                            </Link>
                          ) : null
                        }
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

        <HiddenTray items={available} hidden={hidden} onRestore={toggleHidden} />
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
 * The role-tuned signals the stat cards don't carry (insight attention,
 * unread) — quiet inline links on the masthead's date line.
 */
function MetricsLine({ items }: { items: HomeMetric[] }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <Link key={item.label} href={item.href} className="muted home-metric">
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
    </>
  );
}

/** Role-tuned extra numbers. Owners get the risk figure beside
 *  unread; everyone else just unread (open / due work is in the stat cards).
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

/** Widgets that are safe to render for an impersonated user: their data is
 *  property-readable and keyed by the userId PROP. Widgets backed by
 *  personal-RLS tables or session-derived APIs (shift brief, morning
 *  check-in, notifications, personal pins, calendar day) would silently show
 *  the OWNER's data — hidden instead. */
const IMPERSONATION_SAFE_WIDGETS = new Set([
  "intelligence",
  "your-tasks",
  "deadlines",
  "project-progress",
  "workspace-activity",
  "quick-access",
  "team",
  "property-pulse",
  "attention",
  "workflow-health",
  "recent-docs",
  "pinned",
]);

/* ── "Viewing as" lens preview ─────────────────────────────────────────────── */

/** Lets an owner/manager preview how Home looks for each role — how the
 *  sections are ordered. A preview only, NOT a permission switch: data stays
 *  scoped to the real role; just the ordering and masthead copy change. */
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
