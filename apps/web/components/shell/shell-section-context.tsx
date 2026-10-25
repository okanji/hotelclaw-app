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

/** The rail sections. */
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
  | "bookings"
  | "agents"
  | "assistant";

/**
 * Map a pathname to a section. Returns `null` when the route doesn't pin a
 * section — `/chat/<id>` and `/dms/<id>` now live on distinct prefixes since
 * the route split, so both pin their sections directly.
 */
function sectionFromPath(pathname: string): ShellSection | null {
  // FIRST, before every other check. The Assistant section owns a subtree
  // (`/assistant/projects/<id>`) whose segments collide with sections matched
  // below by substring — `/projects` pins Home, and a section that matched
  // there would swap the whole shell out from under the page. Same class of
  // bug as `/chatbots` needing to beat `/chat`.
  if (pathname.includes("/assistant")) return "assistant";
  // Insights is its own rail section, but still served from `/home/insights`
  // (so every existing deep link keeps working). Match it BEFORE `/home`,
  // which it contains as a substring.
  if (pathname.includes("/home/insights")) return "insights";
  // Home owns its dashboard plus its other sub-views.
  if (pathname.includes("/home")) return "home";
  // Projects and teams live under the Home rail (their sidebar lists them),
  // so those routes keep the Home section active rather than pinning their
  // own.
  if (pathname.includes("/projects")) return "home";
  if (pathname.includes("/spaces")) return "home";
  // The archive lists archived projects/teams — a Home-sidebar footer row.
  if (/\/archive(\/|$)/.test(pathname)) return "home";
  // Forms is a first-class rail section (in More); the Documents sidebar
  // keeps a convenience group pointing at the same routes.
  if (pathname.includes("/forms")) return "forms";
  if (pathname.includes("/bookings")) return "bookings";
  if (pathname.includes("/activity")) return "activity";
  // Before the /chat check — "/chatbots" contains "/chat" as a substring.
  if (pathname.includes("/chatbots")) return "chatbots";
  if (pathname.includes("/agents")) return "agents";
  if (pathname.includes("/workflows")) return "workflows";
  // Before the tasks check — "/my-tasks" contains "/tasks" but is a Home
  // surface (the personal agenda), not the team board.
  if (pathname.includes("/my-tasks")) return "home";
  if (pathname.includes("/tasks")) return "tasks";
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

type ShellSectionContextValue = {
  section: ShellSection;
  setSection: (section: ShellSection) => void;
  /**
   * Keep the current section through the NEXT navigation — called by the
   * section sidebar on click so following one of its links never swaps the
   * sidebar out from under the user.
   */
  holdSectionForNavigation: () => void;
  /**
   * When `true`, the secondary sidebar is hidden so a surface can claim the
   * full content width. Transient + surface-driven (the workflow canvas
   * builder sets this) — reset on every navigation.
   */
  sidebarHidden: boolean;
  setSidebarHidden: (hidden: boolean) => void;
  /**
   * User preference: the secondary sidebar is collapsed (Linear-style). Unlike
   * `sidebarHidden` this persists to a cookie and survives navigation; toggled
   * from the rail button, the `⌘\` shortcut, or a drag-to-collapse.
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
  "bookings",
  "agents",
  "assistant",
];

/** Narrow an untrusted string (e.g. a cookie value) to a ShellSection. */
function asSection(value: string | undefined): ShellSection | undefined {
  return value && (ALL_SECTIONS as string[]).includes(value)
    ? (value as ShellSection)
    : undefined;
}

/**
 * Tracks which rail section is active. The rail writes it on click; the rail
 * and secondary sidebar read it.
 */
export function ShellSectionProvider({
  children,
  initialSection,
  initialCollapsed = false,
}: {
  children: React.ReactNode;
  /**
   * Section restored from the `shell_section` cookie. Post-split, every
   * route either pins a section directly (via `sectionFromPath`) or isn't
   * tied to one at all (the property root), so the cookie now only matters
   * as a fallback default — preserved here for compatibility.
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

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    document.cookie = `sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  // Persist the active section so the next hard refresh on a /chat/* route
  // restores the matching sidebar (the property layout reads this cookie).
  useEffect(() => {
    document.cookie = `shell_section=${section}; path=/; max-age=31536000; SameSite=Lax`;
  }, [section]);

  // Adjust the section during render when navigation lands on a route that
  // pins one (e.g. opening a doc from the command palette). This is React's
  // sanctioned "adjust state on a changed value" pattern — no effect needed.
  //
  // EXCEPT when the navigation started inside the section sidebar: a sidebar
  // click changes the PAGE, never the sidebar under your cursor (ClickUp /
  // gr8r). Without this, the You block's Inbox (→ /activity) swapped the
  // Tasks sidebar for Activity's, a favorite doc swapped in the Docs tree,
  // Chat's Meetings link swapped in Meetings — every item below the one you
  // clicked changed. Rail clicks, ⌘K, notifications, deep links and reloads
  // still pin the section as before.
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [holdSection, setHoldSection] = useState(false);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const pinned = sectionFromPath(pathname);
    if (holdSection) setHoldSection(false);
    else if (pinned && pinned !== section) setSection(pinned);
    // Any navigation cancels a hidden-sidebar request — surfaces opt in fresh
    // on mount so leaving the workflow canvas always restores the sidebar.
    if (sidebarHidden) setSidebarHidden(false);
  }

  // Armed by a sidebar click; consumed by the next pathname change. If the
  // click didn't navigate (a chevron, a dialog opener) it disarms on the next
  // press OUTSIDE the sidebar, or after a few seconds — generous because a
  // server-rendered target (meetings, forms, bookings) can take a while to
  // commit in dev — so a later unrelated navigation still pins normally.
  const holdSectionForNavigation = useCallback(() => setHoldSection(true), []);
  useEffect(() => {
    if (!holdSection) return;
    const timer = window.setTimeout(() => setHoldSection(false), 5000);
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      // Portaled menus opened FROM the sidebar (the New menu) live outside
      // it in the DOM; their click re-arms through the React tree anyway.
      if (!el?.closest?.("[data-section-sidebar]")) setHoldSection(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [holdSection]);

  const value = useMemo<ShellSectionContextValue>(
    () => ({
      section,
      setSection,
      holdSectionForNavigation,
      sidebarHidden,
      setSidebarHidden,
      sidebarCollapsed,
      setSidebarCollapsed,
    }),
    [
      section,
      holdSectionForNavigation,
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
