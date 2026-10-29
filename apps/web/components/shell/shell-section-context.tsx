"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

/** The app's sections — one per product area the sidebar can land in. */
export type ShellSection =
  | "home"
  | "insights"
  | "activity"
  | "chat"
  | "dms"
  | "tasks"
  | "calendar"
  | "docs"
  | "forms"
  | "meetings"
  | "workflows"
  | "chatbots"
  | "agents"
  | "assistant";

/**
 * Map a pathname to a section. Returns `null` when the route doesn't pin a
 * section — `/chat/<id>` and `/dms/<id>` now live on distinct prefixes since
 * the route split, so both pin their sections directly.
 */
export function sectionFromPath(pathname: string): ShellSection | null {
  // FIRST, before every other check. The Assistant section owns a subtree
  // (`/assistant/projects/<id>`) whose segments collide with sections matched
  // below by substring — `/projects` pins Home, and a section that matched
  // there would swap the whole shell out from under the page. Same class of
  // bug as `/chatbots` needing to beat `/chat`.
  if (pathname.includes("/assistant")) return "assistant";
  // Insights is its own section, but still served from `/home/insights`
  // (so every existing deep link keeps working). Match it BEFORE `/home`,
  // which it contains as a substring.
  if (pathname.includes("/home/insights")) return "insights";
  // Home owns its dashboard plus its other sub-views.
  if (pathname.includes("/home")) return "home";
  // Projects and teams are listed in the sidebar's own Teams / Projects
  // groups, so those routes keep Home active rather than pinning their own.
  if (pathname.includes("/projects")) return "home";
  // Initiatives sit above projects (Linear's Workspace → Initiatives); the
  // row lives in the Projects group, so Home stays the active node.
  if (pathname.includes("/initiatives")) return "home";
  if (pathname.includes("/spaces")) return "home";
  // The archive lists archived projects/teams — a Projects-group footer row.
  if (/\/archive(\/|$)/.test(pathname)) return "home";
  // Forms is its own node (under More); the Documents tree keeps a
  // convenience group pointing at the same routes.
  if (pathname.includes("/forms")) return "forms";
  if (pathname.includes("/activity")) return "activity";
  // gr8r's Notifications page reads the same feed as the Inbox.
  if (pathname.includes("/notifications")) return "activity";
  if (/\/favorites(\/|$)/.test(pathname)) return "home";
  // Before the /chat check — "/chatbots" contains "/chat" as a substring.
  if (pathname.includes("/chatbots")) return "chatbots";
  if (pathname.includes("/agents")) return "agents";
  if (pathname.includes("/workflows")) return "workflows";
  // Before the tasks check — "/my-tasks" contains "/tasks" but is the
  // personal agenda (the You block's "My tasks"), not the team board.
  if (pathname.includes("/my-tasks")) return "home";
  if (pathname.includes("/tasks")) return "tasks";
  // Linear's planning surfaces are rows under the Tasks node.
  if (pathname.includes("/triage") || pathname.includes("/cycles")) return "tasks";
  if (pathname.includes("/calendar")) return "calendar";
  if (pathname.includes("/documents")) return "docs";
  if (pathname.includes("/meetings")) return "meetings";
  if (pathname.includes("/dms")) return "dms";
  if (
    pathname.includes("/chat") ||
    pathname.includes("/inbox") ||
    pathname.includes("/threads")
  ) {
    return "chat";
  }
  return null;
}

/**
 * The sidebar node a section lives under. Chat and DMs share one node (Slack:
 * channels and DMs are one pane); everything else is its own node.
 */
export function navNodeFor(section: ShellSection): ShellSection {
  return section === "dms" ? "chat" : section;
}

type ShellSectionContextValue = {
  /** The section the current route belongs to — drives the lit sidebar row. */
  section: ShellSection;
  setSection: (section: ShellSection) => void;
  /**
   * Sidebar nodes whose children are open (Linear's "Your teams" model: the
   * sidebar is ONE tree; a node expands in place, nothing swaps). Persisted
   * per browser; the node the route lands in auto-expands.
   */
  expanded: ReadonlySet<ShellSection>;
  toggleExpanded: (node: ShellSection) => void;
  expand: (node: ShellSection) => void;
  /**
   * When `true`, the sidebar is hidden so a surface can claim the full
   * content width. Transient + surface-driven (the workflow canvas builder
   * sets this) — reset on every navigation.
   */
  sidebarHidden: boolean;
  setSidebarHidden: (hidden: boolean) => void;
  /**
   * User preference: the sidebar is collapsed (Linear-style). Unlike
   * `sidebarHidden` this persists to a cookie and survives navigation; toggled
   * from the « button, the `⌘\` shortcut, or a drag-to-collapse.
   */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

const ShellSectionContext = createContext<ShellSectionContextValue | null>(null);

const ALL_SECTIONS: ShellSection[] = [
  "home",
  "insights",
  "activity",
  "chat",
  "dms",
  "tasks",
  "calendar",
  "docs",
  "forms",
  "meetings",
  "workflows",
  "chatbots",
  "agents",
  "assistant",
];

/** Narrow an untrusted string (e.g. a cookie value) to a ShellSection. */
function asSection(value: string | undefined): ShellSection | undefined {
  return value && (ALL_SECTIONS as string[]).includes(value)
    ? (value as ShellSection)
    : undefined;
}

const EXPANDED_KEY = "hotelclaw:nav-expanded";
/** First-run open set: the daily-driver nodes, like a fresh Linear workspace
 *  opens with your teams expanded. */
const DEFAULT_EXPANDED: ShellSection[] = ["chat"];

/**
 * Tracks which section the route is in, which sidebar nodes are open, and the
 * sidebar's collapsed/hidden state.
 */
export function ShellSectionProvider({
  children,
  initialSection,
  initialCollapsed = false,
}: {
  children: React.ReactNode;
  /**
   * Section restored from the `shell_section` cookie. Every route either
   * pins a section directly (via `sectionFromPath`) or isn't tied to one at
   * all (the property root), so the cookie only matters as a fallback
   * default — preserved for compatibility.
   */
  initialSection?: string;
  /** Collapsed preference restored server-side from the `sidebar_collapsed`
   *  cookie so the first paint already matches (no expand→collapse flash). */
  initialCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [section, setSection] = useState<ShellSection>(
    () => sectionFromPath(pathname) ?? asSection(initialSection) ?? "home",
  );
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(initialCollapsed);
  const [expanded, setExpanded] = useState<Set<ShellSection>>(
    () => new Set(DEFAULT_EXPANDED),
  );

  // Restore the open set after mount — localStorage is unavailable during
  // SSR, so this can't live in the `useState` initializer.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      if (!raw) return;
      const parsed = (JSON.parse(raw) as string[])
        .map(asSection)
        .filter((s): s is ShellSection => !!s);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(new Set(parsed));
    } catch {
      // Storage unavailable or malformed — keep the defaults.
    }
  }, []);

  const persistExpanded = useCallback((next: Set<ShellSection>) => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // Preference only.
    }
  }, []);

  // Each node opens and closes on its own — expanding one never folds the
  // others (user preference, 2026-10-25).
  const toggleExpanded = useCallback(
    (node: ShellSection) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(node)) next.delete(node);
        else next.add(node);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const expand = useCallback(
    (node: ShellSection) => {
      setExpanded((current) => {
        if (current.has(node)) return current;
        const next = new Set(current).add(node);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    document.cookie = `sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  // Persist the active section so the next hard refresh on an un-pinned
  // route restores the matching lit row (the property layout reads this).
  useEffect(() => {
    document.cookie = `shell_section=${section}; path=/; max-age=31536000; SameSite=Lax`;
  }, [section]);

  // Adjust the section during render when navigation lands on a route that
  // pins one (e.g. opening a doc from the command palette). This is React's
  // sanctioned "adjust state on a changed value" pattern — no effect needed.
  // With one sidebar tree a section change only moves the lit row, so there
  // is no longer a "sidebar swapped under your cursor" case to guard.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const pinned = sectionFromPath(pathname);
    if (pinned && pinned !== section) {
      setSection(pinned);
      // Landing in a new section opens its node (Linear expands the team
      // you navigate into), so the lit child row is never hidden under a
      // closed parent. Only on a SECTION change — a user who closed Chat
      // and clicks between channels keeps it closed.
      expand(navNodeFor(pinned));
    }
    // Any navigation cancels a hidden-sidebar request — surfaces opt in fresh
    // on mount so leaving the workflow canvas always restores the sidebar.
    if (sidebarHidden) setSidebarHidden(false);
  }

  const value = useMemo<ShellSectionContextValue>(
    () => ({
      section,
      setSection,
      expanded,
      toggleExpanded,
      expand,
      sidebarHidden,
      setSidebarHidden,
      sidebarCollapsed,
      setSidebarCollapsed,
    }),
    [
      section,
      expanded,
      toggleExpanded,
      expand,
      sidebarHidden,
      sidebarCollapsed,
      setSidebarCollapsed,
    ],
  );

  return (
    <ShellSectionContext.Provider value={value}>
      {children}
    </ShellSectionContext.Provider>
  );
}

export function useShellSection() {
  const ctx = useContext(ShellSectionContext);
  if (!ctx) {
    throw new Error("useShellSection must be used within a ShellSectionProvider");
  }
  return ctx;
}
