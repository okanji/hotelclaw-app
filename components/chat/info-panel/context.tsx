"use client";

import { createContext, useContext, useState } from "react";

type InfoPanelTab = "members" | "pinned" | "about";

type InfoPanelContextValue = {
  open: boolean;
  tab: InfoPanelTab;
  toggle: () => void;
  setTab: (t: InfoPanelTab) => void;
  close: () => void;
};

const Ctx = createContext<InfoPanelContextValue | null>(null);

/**
 * Holds the open/tab state for the channel info panel so it persists across
 * channel switches within a session — same UX as Slack's right rail.
 */
export function InfoPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InfoPanelTab>("members");
  return (
    <Ctx.Provider
      value={{
        open,
        tab,
        toggle: () => setOpen((o) => !o),
        setTab,
        close: () => setOpen(false),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useInfoPanel() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInfoPanel must be used inside InfoPanelProvider");
  return v;
}
