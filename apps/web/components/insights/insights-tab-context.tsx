"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { PROPERTY_SCOPE, type InsightScope } from "@/lib/insights/scope";

/** The three dashboard tabs. Reports is URL-addressable
 *  (`/home/insights/reports`) so it can be deep-linked, and so isn't part of
 *  this state — the surface derives it from the pathname. */
export type InsightDashTab = "overview" | "work" | "operations";

type InsightsTabContextValue = {
  /** Active dashboard tab (not Reports — that lives in the URL). */
  dashTab: InsightDashTab;
  setDashTab: (tab: InsightDashTab) => void;
  /** The lens the whole surface reads through (property / project / team /
   *  person). Shared so the secondary sidebar can gate property-only views. */
  scope: InsightScope;
  setScope: (scope: InsightScope) => void;
};

const InsightsTabContext = createContext<InsightsTabContextValue | null>(null);

/**
 * Shared Insights view state, lifted above the shell so the secondary sidebar
 * (which lists the views) and the content surface (which renders them) read the
 * same active tab and lens. Insights is a persistent client surface gated on
 * the pathname, so — unlike the server-rendered sections — it can't drive its
 * tabs through `?view=` search params; this context is how the two panes stay
 * in lockstep instead.
 */
export function InsightsTabProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dashTab, setDashTab] = useState<InsightDashTab>("overview");
  const [scope, setScope] = useState<InsightScope>(PROPERTY_SCOPE);
  const value = useMemo(
    () => ({ dashTab, setDashTab, scope, setScope }),
    [dashTab, scope],
  );
  return (
    <InsightsTabContext.Provider value={value}>
      {children}
    </InsightsTabContext.Provider>
  );
}

export function useInsightsTab() {
  const ctx = useContext(InsightsTabContext);
  if (!ctx) {
    throw new Error("useInsightsTab must be used within an InsightsTabProvider");
  }
  return ctx;
}
