"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Bell, CalendarDays, Search, Sparkle } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PropertySwitcher } from "./property-switcher";
import { useCommandPalette } from "./command-palette-context";
import { useNotifications } from "./use-notifications";
import type { Membership } from "@/lib/auth/session";

/**
 * The global top bar (ClickUp's, 2026-10-29): one THIN strip across the
 * whole app above rail + sidebar + content. Left: the org picker, a back
 * button (browser history — the section surfaces navigate by pushState,
 * so every in-app hop is an entry, and they all listen for popstate) and a
 * today shortcut; middle: a per-page slot (`TopBarPage` portals a page's
 * own controls here); right: the ⌘K search, the bell and "AI Chats" (the
 * Assistant). What used to be the page `.topbar`'s right cluster
 * (`TopbarActions`: search / bell / New) lives here now — the page header
 * keeps crumbs + its own actions, and New became the sidebar header's
 * "+ ▾". Desktop only; `MobileTopBar` owns < md.
 */
export function TopBar({
  propertyId,
  memberships,
  user,
  isGuest,
}: {
  propertyId: string;
  memberships: Membership[];
  user: { id: string; email: string };
  isGuest: boolean;
}) {
  const base = `/p/${propertyId}`;
  const { toggle } = useCommandPalette();
  const { unseenCount } = useNotifications(user.id);
  const { setSlot } = useTopBarSlot();
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="gtop max-md:hidden" aria-label="Workspace">
      <PropertySwitcher
        currentPropertyId={propertyId}
        memberships={memberships}
        email={user.email}
      />
      <button
        type="button"
        className="ibtn ibtn-sm"
        title="Back"
        aria-label="Back to the previous page"
        onClick={() => window.history.back()}
      >
        <Gi icon={ArrowLeft} size={16} />
      </button>
      {isGuest ? null : (
        <Link href={`${base}/calendar`} className="ibtn ibtn-sm" title="Today" aria-label="Today">
          <Gi icon={CalendarDays} size={16} />
        </Link>
      )}
      {/* Per-page controls (`TopBarPage`). */}
      <div ref={setSlot} className="gtop-page row" style={{ gap: 4 }} />
      <span className="sp" />
      <button type="button" className="topsearch" onClick={toggle} aria-label="Search and commands">
        <Gi icon={Search} size={14} />
        <span className="lbltxt">Search or jump to…</span>
        <span className="kbd">{mac ? "⌘K" : "Ctrl K"}</span>
      </button>
      <Link
        href={`${base}/activity?view=unread`}
        className="ibtn"
        title="Notifications"
        aria-label={unseenCount > 0 ? `Notifications, ${unseenCount} unread` : "Notifications"}
      >
        <Gi icon={Bell} />
        {unseenCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 7,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--g8-accent)",
              boxShadow: "0 0 0 2px var(--g8-bg-side)",
            }}
          />
        ) : null}
      </Link>
      {isGuest ? null : (
        <Link href={`${base}/assistant`} className="btn btn-secondary btn-sm" title="Ask the assistant">
          <span>AI Chats</span>
          <Gi icon={Sparkle} size={14} />
        </Link>
      )}
    </header>
  );
}

/* ---------- Per-page slot ---------- */

type TopBarSlotValue = {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
};

const TopBarSlotContext = createContext<TopBarSlotValue>({
  slot: null,
  setSlot: () => {},
});

/** Holds the top bar's page-slot element so `TopBarPage` can portal into it. */
export function TopBarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <TopBarSlotContext.Provider value={value}>{children}</TopBarSlotContext.Provider>;
}

function useTopBarSlot() {
  return useContext(TopBarSlotContext);
}

/**
 * Put a page's own controls on the top bar for as long as the page is
 * mounted (ClickUp shows page-specific bits up there). Renders nothing
 * until the bar exists; several pages mounting at once simply append.
 */
export function TopBarPage({ children }: { children: ReactNode }) {
  const { slot } = useTopBarSlot();
  if (!slot) return null;
  return createPortal(children, slot);
}
