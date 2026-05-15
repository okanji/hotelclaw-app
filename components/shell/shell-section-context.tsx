"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

/** The five rail sections. */
export type ShellSection = "activity" | "chat" | "dms" | "tasks" | "docs";

/**
 * Map a pathname to a section. Returns `null` when the route doesn't pin a
 * section — notably `/chat/*`, which is shared by team channels (Chat) and
 * DMs. On those routes an explicit rail choice is preserved.
 */
function sectionFromPath(pathname: string): ShellSection | null {
  if (pathname.includes("/activity")) return "activity";
  if (pathname.includes("/tasks")) return "tasks";
  if (pathname.includes("/documents")) return "docs";
  if (pathname.includes("/inbox") || pathname.includes("/threads")) return "chat";
  return null;
}

type ShellSectionContextValue = {
  section: ShellSection;
  setSection: (section: ShellSection) => void;
};

const ShellSectionContext = createContext<ShellSectionContextValue | null>(null);

/**
 * Tracks which rail section is active. The rail writes it on click; the rail
 * and secondary sidebar read it.
 */
export function ShellSectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [section, setSection] = useState<ShellSection>(
    () => sectionFromPath(pathname) ?? "chat",
  );

  // Adjust the section during render when navigation lands on a route that
  // pins one (e.g. opening a doc from the command palette). This is React's
  // sanctioned "adjust state on a changed value" pattern — no effect needed.
  // `/chat/*` routes pin nothing, so an explicit Chat/DMs rail choice there
  // survives.
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
