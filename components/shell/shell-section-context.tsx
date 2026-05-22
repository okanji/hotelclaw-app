"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

/** The seven rail sections. */
export type ShellSection =
  | "activity"
  | "chat"
  | "dms"
  | "tasks"
  | "calendar"
  | "docs"
  | "meetings";

/**
 * Map a pathname to a section. Returns `null` when the route doesn't pin a
 * section — `/chat/<id>` and `/dms/<id>` now live on distinct prefixes since
 * the route split, so both pin their sections directly.
 */
function sectionFromPath(pathname: string): ShellSection | null {
  if (pathname.includes("/activity")) return "activity";
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
};

const ShellSectionContext = createContext<ShellSectionContextValue | null>(null);

const ALL_SECTIONS: ShellSection[] = [
  "activity",
  "chat",
  "dms",
  "tasks",
  "calendar",
  "docs",
  "meetings",
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
}: {
  children: React.ReactNode;
  /**
   * Section restored from the `shell_section` cookie. Post-split, every
   * route either pins a section directly (via `sectionFromPath`) or isn't
   * tied to one at all (the property root), so the cookie now only matters
   * as a fallback default — preserved here for compatibility.
   */
  initialSection?: string;
}) {
  const pathname = usePathname();
  const [section, setSection] = useState<ShellSection>(
    () => sectionFromPath(pathname) ?? asSection(initialSection) ?? "chat",
  );

  // Persist the active section so the next hard refresh on a /chat/* route
  // restores the matching sidebar (the property layout reads this cookie).
  useEffect(() => {
    document.cookie = `shell_section=${section}; path=/; max-age=31536000; SameSite=Lax`;
  }, [section]);

  // Adjust the section during render when navigation lands on a route that
  // pins one (e.g. opening a doc from the command palette). This is React's
  // sanctioned "adjust state on a changed value" pattern — no effect needed.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const pinned = sectionFromPath(pathname);
    if (pinned && pinned !== section) setSection(pinned);
  }

  const value = useMemo<ShellSectionContextValue>(
    () => ({ section, setSection }),
    [section],
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
