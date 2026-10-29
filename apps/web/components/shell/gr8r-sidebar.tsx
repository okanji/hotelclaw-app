"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Calendar,
  ChartGantt,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Ellipsis,
  FileText,
  FolderKanban,
  House,
  Inbox,
  IterationCcw,
  Keyboard,
  LayoutDashboard,
  Link2,
  List,
  ListChecks,
  ListFilter,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Star,
  Users,
  type LucideIcon,
  Filter,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { isDone } from "@/lib/tasks/statuses";
import { isAssignedTo } from "@/lib/tasks/assignees";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { railModeFor, type RailMode } from "./app-rail";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { useFavorites } from "@/lib/favorites/use-favorites";
import { FavMark } from "@/components/gr8r/favorite-star";
import {
  triageQueueQueryOptions,
  useTriageRealtime,
  type TriageQueueItem,
} from "@/lib/query/triage-queries";
import { useOpenSpace } from "@/lib/spaces/use-open-space";
import type { EntityColor } from "@/lib/db/types";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { Gi } from "@/components/gr8r/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CloseSidebarIcon } from "./clickup-icons";
import { DocumentsTreeSection } from "@/components/documents/documents-tree-section";
import { ChatSection } from "./sections/chat-section";
import { AssistantSection } from "./sections/assistant-section";
import { FormsSection } from "./sections/forms-section";
import { InsightsSection } from "./sections/insights-section";
import { WorkflowsSection } from "./sections/workflows-section";
import { NewMenu } from "./new-menu";
import { UserMenu } from "./user-menu";
import { useNotifications } from "./use-notifications";
import { target } from "./nav-node";
import {
  usePrewarmSections,
  useSectionNavigation,
} from "./use-section-navigation";
import { useCommandPalette } from "./command-palette-context";
import { useShellSection } from "./shell-section-context";
import { DEFAULT_PINS } from "./nav-apps";
import { useNavPrefs } from "./use-nav-prefs";
import type { Membership } from "@/lib/auth/session";

/**
 * THE sidebar — gr8r-studio's `renderSidebar` (src/shell/layout.js) rendered
 * as React with gr8r's own classes (`app/gr8r.css`, scoped under `.g8`):
 * `.side` › `.side-top` (`.ws` switcher + collapse) › `.side-scroll` ›
 * `.side-bot` (Help, Settings, user). The `.side-scroll` body follows the
 * app rail beside it (`app-rail.tsx`, 2026-10-29): in `home` mode it is
 * gr8r's tree (top block, WORKSPACE, PROJECTS, TEAMS — Forms sits after
 * Favorites; each team expands to Triage + its lists the way a project
 * expands to its views); in `chat` / `docs` / `assistant` / `insights` mode
 * it is that section's own navigation (the old `sections/*` bodies), full
 * height. More is a rail button (the app-launcher modal) and the only way to
 * Meetings, Workflows, Chatbots, Agents, Initiatives and Org chart.
 * `collapsed` = gr8r's 52px icon rail.
 */
export function Gr8rSidebar({
  currentPropertyId: propertyId,
  memberships,
  user,
  collapsed,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  collapsed: boolean;
}) {
  const role = memberships.find((m) => m.property_id === propertyId)?.role;
  const isGuest = role === "guest";
  const isManagement = role === "owner" || role === "manager";
  const base = `/p/${propertyId}`;
  const pathname = usePathname();
  const search = useSearchParams();
  const { navigate } = useSectionNavigation(propertyId);
  const { unseenCount } = useNotifications(user.id);
  const { setSidebarCollapsed } = useShellSection();
  const { toggle: togglePalette } = useCommandPalette();
  const { hidden } = useNavPrefs(DEFAULT_PINS);

  // gr8r's My Tasks count: mine, open, due today or overdue.
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const dueMine = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return tasks.filter(
      (t) =>
        isAssignedTo(t, user.id) &&
        !isDone(t) &&
        !!t.due_at &&
        new Date(t.due_at) <= end,
    ).length;
  }, [tasks, user.id]);

  // Inbox resumes its last path (pushState fast path for the client-rendered
  // sections); Chat + Docs are warmed here even though their rows now live on
  // the rail, so the first rail click is a cache hit.
  const inbox = useMemo(() => target(base, "activity", "/activity", "/activity"), [base]);
  const prewarm = useMemo(
    () => [target(base, "chat", "/chat"), target(base, "docs", "/documents", "/documents")],
    [base],
  );
  usePrewarmSections(propertyId, user.id, prewarm);
  // The rail decides which body this sidebar shows.
  const mode: RailMode = railModeFor(base, pathname);

  const at = (path: string) =>
    pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`);
  const tip = (label: string) => (collapsed ? label : undefined);

  const row = (
    key: string,
    href: string,
    label: string,
    icon: LucideIcon,
    on: boolean,
    opt: {
      ct?: number;
      dot?: boolean;
      onClick?: (e: React.MouseEvent) => void;
      body?: React.ReactNode;
    } = {},
  ) => (
    <SItem
      body={opt.body}
      collapsed={collapsed}
      key={key}
      href={href}
      label={label}
      icon={icon}
      on={on}
      tip={tip(label)}
      ct={opt.ct}
      dot={opt.dot}
      onClick={opt.onClick}
    />
  );
  const resume = (t: ReturnType<typeof target>) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(t);
  };

  return (
    <nav className="side" aria-label="Main" style={{ height: "100%" }}>
      {/* ClickUp's sidebar header (2026-10-29): the section's name, then
          tools that slide + fade in only while the pointer is over the
          sidebar (search → ⌘K, filter → Settings › Sidebar, « collapse),
          then the always-visible "+ ▾" create menu. The org picker moved to
          the global top bar. */}
      <div className="side-top">
        <div className="side-h">
          <h2 className="side-ttl trunc">{SECTION_TITLE[mode]}</h2>
          <span className="sp" />
          <div className="side-tools">
            <button
              type="button"
              className="ibtn"
              title="Search (⌘K)"
              aria-label="Search and commands"
              onClick={togglePalette}
            >
              <Gi icon={Search} size={16} />
            </button>
            {isGuest ? null : (
              <Link
                href={`${base}/settings?sec=sidebar`}
                className="ibtn"
                title="Customize sidebar"
                aria-label="Customize sidebar"
              >
                <Gi icon={ListFilter} size={16} />
              </Link>
            )}
            <SidebarCollapseButton onCollapse={() => setSidebarCollapsed(true)} />
          </div>
          {isGuest ? null : <NewMenu propertyId={propertyId} variant="split" />}
        </div>
      </div>

      {mode !== "home" ? (
        // A section's own navigation fills the sidebar (the rail picked it).
        <div className="side-scroll">
          <Suspense fallback={null}>
            {mode === "chat" ? (
              <ChatSection propertyId={propertyId} userId={user.id} isChannelAdmin={isManagement} />
            ) : mode === "docs" ? (
              <DocumentsTreeSection propertyId={propertyId} />
            ) : mode === "assistant" ? (
              <AssistantSection propertyId={propertyId} />
            ) : mode === "automations" ? (
              <WorkflowsSection propertyId={propertyId} />
            ) : (
              <InsightsSection propertyId={propertyId} isManagement={isManagement} />
            )}
          </Suspense>
        </div>
      ) : (
      <div className="side-scroll">
        {row("home", `${base}/home`, "Home", House, pathname === `${base}/home` || pathname === base)}
        {row(
          "inbox",
          inbox.href,
          "Inbox",
          Inbox,
          at("/activity"),
          { ct: unseenCount, dot: true, onClick: resume(inbox) },
        )}
        {row("mytasks", `${base}/my-tasks`, "My Tasks", CircleCheck, at("/my-tasks"), {
          ct: dueMine,
        })}
        {row("favorites", `${base}/favorites`, "Favorites", Star, at("/favorites"))}
        {isGuest
          ? null
          : row("forms", `${base}/forms`, "Forms", ClipboardList, at("/forms"), {
              body: <FormsSection propertyId={propertyId} />,
            })}

        {isGuest ? (
          <div className="sgroup">
            <div className="sgroup-h">Shared with you</div>
            {row("g-tasks", `${base}/tasks`, "Tasks", ListChecks, at("/tasks"))}
          </div>
        ) : (
          <>
            <div className="sgroup">
              <div className="sgroup-h">Workspace</div>
              {row("overview", `${base}/overview`, "Overview", LayoutDashboard, at("/overview"))}
              {row("projects", `${base}/projects`, "Projects", FolderKanban, pathname === `${base}/projects`)}
              {row(
                "tasks",
                `${base}/tasks`,
                "Tasks",
                ListChecks,
                at("/tasks") && !search.get("list"),
              )}
              {row("calendar", `${base}/calendar`, "Calendar", Calendar, at("/calendar"))}
              {row("timeline", `${base}/timeline`, "Timeline", ChartGantt, at("/timeline"))}
              {row("members", `${base}/members`, "Members", Users, at("/members"))}
              {row("cycles", `${base}/cycles`, "Cycles", IterationCcw, at("/cycles"))}
            </div>
          </>
        )}

        <ProjectsAndTeams
          propertyId={propertyId}
          collapsed={collapsed}
          showProjects={!isGuest && !hidden.includes("projects")}
          showTeams={!hidden.includes("teams")}
          canTriage={role !== undefined && !isGuest}
        />
      </div>
      )}

      <div className="side-bot">
        {isGuest ? null : <HelpMenu collapsed={collapsed} />}
        {isGuest ? null : row("settings", `${base}/settings`, "Settings", Settings, at("/settings"))}
        <UserMenu user={user} />
      </div>
    </nav>
  );
}

/** ClickUp-style « close button — part of the hover-only `.side-tools`. */
function SidebarCollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Close sidebar"
            className="ibtn max-md:hidden"
          >
            <CloseSidebarIcon className="size-4" />
          </button>
        }
      />
      <TooltipContent side="bottom">
        Close sidebar
        <kbd className="ml-1.5 font-sans text-xs font-normal opacity-60">⌘\</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * gr8r `sItem()`: one `.sitem` row; `ct` + `dot` = the accent count pill.
 * With `body`, the row becomes a gr8r `.sproj` tree node: a hover chevron,
 * and the section's own navigation (channels, the docs tree, assistant
 * projects…) in a `.sub` beneath it — open whenever you're
 * in that section, or when toggled. The body mounts only while open.
 */
function SItem({
  href,
  label,
  icon,
  on,
  tip,
  ct,
  dot,
  onClick,
  body,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  on: boolean;
  tip?: string;
  ct?: number;
  dot?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  body?: React.ReactNode;
  collapsed?: boolean;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = body ? (toggled ?? on) : false;
  const row = (
    <Link
      href={href}
      onClick={onClick}
      className={on && !open ? "sitem on" : "sitem"}
      title={tip}
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={icon} />
      <span className="trunc">{label}</span>
      {ct ? <span className={dot ? "ct dotc" : "ct"}>{ct > 99 ? "99+" : ct}</span> : null}
      {body ? (
        <span className="hov" style={ct ? { marginLeft: 4 } : undefined}>
          <span
            className="ibtn ibtn-xs"
            role="button"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={open}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setToggled(!open);
            }}
          >
            <Gi icon={ChevronRight} size={13} className={open ? "chev open" : "chev"} />
          </span>
        </span>
      ) : null}
    </Link>
  );
  if (!body) return row;
  return (
    <div className="sproj">
      {row}
      <div className={open && !collapsed ? "sub open" : "sub"}>
        {open && !collapsed ? <Suspense fallback={null}>{body}</Suspense> : null}
      </div>
    </div>
  );
}

/** The sidebar header's title per rail mode (and the heading over a
 *  section's own navigation). */
const SECTION_TITLE: Record<RailMode, string> = {
  home: "Home",
  chat: "Chat",
  docs: "Docs",
  assistant: "Assistant",
  insights: "Insights",
  automations: "Auto",
};

function HelpMenu({ collapsed }: { collapsed: boolean }) {
  const { setOpen } = useCommandPalette();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="sitem" title={collapsed ? "Help" : undefined}>
        <Gi icon={CircleHelp} />
        <span>Help &amp; resources</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-60">
        <DropdownMenuLabel>Help &amp; resources</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setOpen(true)}>
          <Keyboard className="size-4" />
          Search &amp; commands
          <kbd className="ml-auto">⌘K</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="mailto:support@hotelclaw.app" />}>
          <CircleHelp className="size-4" />
          Contact support
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** EntityColor → gr8r palette token (`--c` on `.pico`). */
const PCOLOR: Record<EntityColor, string> = {
  slate: "var(--g8-gray)",
  blue: "var(--g8-blue)",
  green: "var(--g8-green)",
  amber: "var(--g8-amber)",
  rose: "var(--g8-rose)",
  violet: "var(--g8-violet)",
};

/** gr8r PSTAT over our project statuses. */
const PSTAT: Record<string, { name: string; c: string }> = {
  planned: { name: "Planning", c: "var(--g8-gray)" },
  active: { name: "In Progress", c: "var(--g8-blue)" },
  completed: { name: "Completed", c: "var(--g8-green)" },
  archived: { name: "Archived", c: "var(--g8-gray)" },
};

const PROJECT_TABS: { tab: string; label: string; icon: LucideIcon }[] = [
  { tab: "board", label: "Board", icon: SquareKanban },
  { tab: "list", label: "List", icon: List },
  { tab: "timeline", label: "Timeline", icon: ChartGantt },
  { tab: "docs", label: "Docs", icon: FileText },
];

function plain(e: React.MouseEvent) {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);
}

/**
 * gr8r's PROJECTS group (`.sproj` rows: `.pico` tile, name, `.sdot` status,
 * hover `.hov` ellipsis + chevron, `.sub` Board / List / Timeline / Files,
 * then Archive) and TEAMS group — ours expand to the team's lists.
 */
function ProjectsAndTeams({
  propertyId,
  collapsed,
  showProjects,
  showTeams,
  canTriage,
}: {
  propertyId: string;
  collapsed: boolean;
  showProjects: boolean;
  showTeams: boolean;
  /** Full members: each team gets a Triage row (Linear's per-team queue). */
  canTriage: boolean;
}) {
  const base = `/p/${propertyId}`;
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const openProject = useOpenProject(propertyId);
  const openSpace = useOpenSpace(propertyId);
  const catalog = useStatusCatalog(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const [expanded, toggle] = useExpandedIds();
  // gr8r marks starred projects with a small amber star (`.sitem .fav`).
  const fav = useFavorites(propertyId, { realtime: true });
  // Pending intake per team, for each team's Triage row (Linear-style).
  const { data: triageQueue = EMPTY_TRIAGE } = useQuery({
    ...triageQueueQueryOptions(propertyId),
    enabled: canTriage,
  });
  useTriageRealtime(propertyId);
  const triageByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triageQueue) if (t.space_id) m.set(t.space_id, (m.get(t.space_id) ?? 0) + 1);
    return m;
  }, [triageQueue]);
  const [dialog, setDialog] = useState<{ open: boolean; kind: "space" | "project" }>({
    open: false,
    kind: "project",
  });

  // Live: spaces + projects are realtime-published.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`gr8r-sidebar:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `property_id=eq.${propertyId}` },
        () => qc.invalidateQueries({ queryKey: ["projects", propertyId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "spaces", filter: `property_id=eq.${propertyId}` },
        () => qc.invalidateQueries({ queryKey: ["spaces", propertyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  // gr8r hides completed projects from the tree.
  const live = projects.filter((p) => p.status !== "completed" && p.status !== "archived");
  const tab = search.get("tab");

  return (
    <>
      {showProjects ? (
        <div className="sgroup">
          <div className="sgroup-h">
            <span>Projects</span>
            <span className="sp" />
            <button
              type="button"
              className="ibtn ibtn-xs"
              title="New project"
              aria-label="New project"
              onClick={() => setDialog({ open: true, kind: "project" })}
            >
              <Gi icon={Plus} size={14} />
            </button>
          </div>
          {live.map((p) => {
            const on = pathname.startsWith(`${base}/projects/${p.id}`);
            const open = expanded.has(p.id);
            const href = `${base}/projects/${p.id}`;
            const st = PSTAT[p.status] ?? PSTAT.planned!;
            return (
              <div className="sproj" key={p.id}>
                {/* gr8r: a div role=link (it holds buttons). */}
                <div
                  role="link"
                  tabIndex={0}
                  data-href={href}
                  className={on ? "sitem on" : "sitem"}
                  title={collapsed ? p.name : undefined}
                  aria-current={on ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
                    else openProject(p.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openProject(p.id);
                  }}
                >
                  <span
                    className="pico"
                    style={{ "--g8-c": PCOLOR[p.color] ?? PCOLOR.slate } as React.CSSProperties}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(p.id);
                    }}
                    aria-label="Toggle sub-pages"
                  >
                    {p.icon ? (
                      <span style={{ fontSize: 11, lineHeight: 1 }}>{p.icon}</span>
                    ) : (
                      <Gi icon={FolderKanban} size={12} />
                    )}
                  </span>
                  <span className="trunc">{p.name}</span>
                  {fav.isFavorite("project", p.id) ? <FavMark size={11} /> : null}
                  <span className="sdot" style={{ background: st.c }} title={st.name} />
                  <span className="hov">
                    <ProjectMenu
                      href={href}
                      onOpen={(t) => openProject(p.id, t)}
                      favorite={fav.isFavorite("project", p.id)}
                      onToggleFavorite={() => void fav.toggle("project", p.id, p.name)}
                    />
                    <span
                      className="ibtn ibtn-xs"
                      role="button"
                      aria-label="Expand"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(p.id);
                      }}
                    >
                      <Gi icon={ChevronRight} size={13} className={open ? "chev open" : "chev"} />
                    </span>
                  </span>
                </div>
                <div className={open && !collapsed ? "sub open" : "sub"}>
                  {PROJECT_TABS.map((v) => (
                    <Link
                      key={v.tab}
                      href={`${href}?tab=${v.tab}`}
                      className={on && tab === v.tab ? "sitem on" : "sitem"}
                      onClick={(e) => {
                        if (!plain(e)) return;
                        e.preventDefault();
                        openProject(p.id, v.tab);
                      }}
                    >
                      <Gi icon={v.icon} size={14} />
                      <span>{v.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
          <SItem
            href={`${base}/archive`}
            label="Archive"
            icon={Archive}
            on={pathname.startsWith(`${base}/archive`)}
            tip={collapsed ? "Archive" : undefined}
          />
        </div>
      ) : null}

      {showTeams ? (
        <div className="sgroup">
          <div className="sgroup-h">
            <span>Teams</span>
            <span className="sp" />
            <button
              type="button"
              className="ibtn ibtn-xs"
              title="New team"
              aria-label="New team"
              onClick={() => setDialog({ open: true, kind: "space" })}
            >
              <Gi icon={Plus} size={14} />
            </button>
          </div>
          {/* Property-level lists (no team — e.g. "General"): plain list
              rows above the teams, so every list stays reachable. */}
          {catalog.listsOfSpace(null).map((l) => (
            <Link
              key={l.id}
              href={`${base}/tasks?list=${l.id}`}
              className={
                pathname === `${base}/tasks` && search.get("list") === l.id
                  ? "sitem on"
                  : "sitem"
              }
              title={collapsed ? l.name : undefined}
            >
              {l.icon ? (
                <span style={{ width: 16, textAlign: "center", fontSize: 12 }}>{l.icon}</span>
              ) : (
                <Gi icon={List} />
              )}
              <span className="trunc">{l.name}</span>
            </Link>
          ))}
          {spaces.map((s) => {
            const on = pathname.startsWith(`${base}/spaces/${s.id}`);
            const lists = catalog.listsOfSpace(s.id);
            const open = expanded.has(s.id);
            const href = `${base}/spaces/${s.id}`;
            return (
              <div className="sproj" key={s.id}>
                {/* gr8r: a div role=link (it holds buttons). */}
                <div
                  role="link"
                  tabIndex={0}
                  data-href={href}
                  className={on ? "sitem on" : "sitem"}
                  title={collapsed ? s.name : undefined}
                  aria-current={on ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
                    else openSpace(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openSpace(s.id);
                  }}
                >
                  {s.icon ? (
                    <span className="pico" style={{ "--g8-c": PCOLOR[s.color] } as React.CSSProperties}>
                      <span style={{ fontSize: 11, lineHeight: 1 }}>{s.icon}</span>
                    </span>
                  ) : (
                    <Gi icon={Users} />
                  )}
                  <span className="trunc">{s.name}</span>
                  {triageByTeam.get(s.id) && !open ? (
                    <span className="ct" title={`${triageByTeam.get(s.id)} in triage`}>
                      {triageByTeam.get(s.id)}
                    </span>
                  ) : null}
                  {lists.length > 0 || canTriage ? (
                    <span className="hov">
                      <span
                        className="ibtn ibtn-xs"
                        role="button"
                        aria-label={open ? `Collapse ${s.name}` : `Expand ${s.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(s.id);
                        }}
                      >
                        <Gi icon={ChevronRight} size={13} className={open ? "chev open" : "chev"} />
                      </span>
                    </span>
                  ) : null}
                </div>
                {lists.length > 0 || canTriage ? (
                  <div className={open && !collapsed ? "sub open" : "sub"}>
                    {canTriage ? (
                      <Link
                        href={`${base}/triage?team=${s.id}`}
                        className={
                          pathname === `${base}/triage` && search.get("team") === s.id
                            ? "sitem on"
                            : "sitem"
                        }
                      >
                        <Gi icon={Filter} size={14} />
                        <span className="trunc">Triage</span>
                        {triageByTeam.get(s.id) ? (
                          <span className="ct">{triageByTeam.get(s.id)}</span>
                        ) : null}
                      </Link>
                    ) : null}
                    {lists.map((l) => (
                      <Link
                        key={l.id}
                        href={`${base}/tasks?list=${l.id}`}
                        className={
                          pathname === `${base}/tasks` && search.get("list") === l.id
                            ? "sitem on"
                            : "sitem"
                        }
                      >
                        {l.icon ? (
                          <span style={{ width: 14, textAlign: "center", fontSize: 12 }}>{l.icon}</span>
                        ) : (
                          <Gi icon={List} size={14} />
                        )}
                        <span className="trunc">{l.name}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <CreateEntityDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        propertyId={propertyId}
        kind={dialog.kind}
      />
    </>
  );
}

const EMPTY_TRIAGE: TriageQueueItem[] = [];

/** gr8r's hover ellipsis on a project row → the project context menu. */
function ProjectMenu({
  href,
  onOpen,
  favorite,
  onToggleFavorite,
}: {
  href: string;
  onOpen: (tab?: string) => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ibtn ibtn-xs"
        aria-label="Project options"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Gi icon={Ellipsis} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-48">
        <DropdownMenuItem onClick={() => onOpen()}>
          <FolderKanban className="size-4" />
          Open
        </DropdownMenuItem>
        {PROJECT_TABS.map((v) => (
          <DropdownMenuItem key={v.tab} onClick={() => onOpen(v.tab)}>
            <v.icon className="size-4" />
            {v.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleFavorite}>
          <Star className="size-4" />
          {favorite ? "Remove from favorites" : "Add to favorites"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${href}`)}
        >
          <Link2 className="size-4" />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const EXPANDED_KEY = "hotelclaw:sidebar-expanded";

/** Which project / team rows are expanded — remembered per browser. */
function useExpandedIds(): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage unavailable — rows start collapsed.
    }
  }, []);
  const toggle = (id: string) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // Preference only.
      }
      return next;
    });
  return [ids, toggle];
}

/** Suspense boundary for useSearchParams consumers. */
export function Gr8rSidebarBoundary(props: React.ComponentProps<typeof Gr8rSidebar>) {
  return (
    <Suspense fallback={<nav className="side" aria-label="Main" />}>
      <Gr8rSidebar {...props} />
    </Suspense>
  );
}
