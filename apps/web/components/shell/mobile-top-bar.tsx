"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleCheck,
  Ellipsis,
  FolderKanban,
  House,
  Inbox,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LeftShell } from "./left-shell";
import { useShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";
import type { Membership } from "@/lib/auth/session";

type User = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Mobile navigation (below `md:`): the 44px transparent top bar (the same
 * height and chrome as the desktop `AppTopBar` — no fill, no bottom border)
 * with a hamburger that opens the full LeftShell (the sidebar tree) in a
 * left drawer. Desktop never renders this — the sidebar sits inline there.
 */
export function MobileTopBar({
  currentPropertyId,
  memberships,
  user,
  propertyName,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  user: User;
  propertyName: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { section } = useShellSection();

  // Close the drawer on any navigation — real route changes (sidebar links)
  // and pushState section hops both land here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname, section]);

  return (
    // `hc-mobile-top-bar`: hidden entirely inside the native app's WebView
    // (html[data-hotelclaw-embed]) — the native header already owns nav there.
    <>
    <header className="hc-mobile-top-bar flex h-11 shrink-0 items-center gap-2 px-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              className="text-muted-foreground"
            />
          }
        >
          <Menu className="size-4" strokeWidth={1.25} />
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          // Portaled out of the shell root, so it carries gr8r's `.g8` scope.
          className="g8 w-[19rem] max-w-[85vw] gap-0 bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Sections, channels, and views for this property.
          </SheetDescription>
          <LeftShell
            currentPropertyId={currentPropertyId}
            memberships={memberships}
            user={user}
            forceExpanded
            className="h-full"
          />
        </SheetContent>
      </Sheet>
      {/* The property name is what you're reading, not a nav row: 14px/500
          full ink (notion-spec §3), not the sidebar's secondary rung. */}
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {propertyName}
      </span>
    </header>
    <BottomNav propertyId={currentPropertyId} userId={user.id} onMore={() => setOpen(true)} />
    </>
  );
}

/**
 * gr8r `renderBottomNav()` (≤640px only — gr8r's responsive.css shows it):
 * Home, My Tasks, Projects, Inbox (accent dot when unread), More → the
 * navigation drawer.
 */
function BottomNav({
  propertyId,
  userId,
  onMore,
}: {
  propertyId: string;
  userId: string;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const { unseenCount } = useNotifications(userId);
  const base = `/p/${propertyId}`;
  const tab = (path: string, label: string, icon: LucideIcon, extra?: React.ReactNode) => {
    const on = pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`);
    return (
      <Link href={`${base}${path}`} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
        <Gi icon={icon} size={19} />
        <span>{label}</span>
        {extra}
      </Link>
    );
  };
  return (
    <nav className="bottomnav hc-mobile-top-bar" aria-label="Primary">
      {tab("/home", "Home", House)}
      {tab("/my-tasks", "My Tasks", CircleCheck)}
      {tab("/projects", "Projects", FolderKanban)}
      {tab("/activity", "Inbox", Inbox, unseenCount > 0 ? <span className="bdot" /> : null)}
      <button type="button" onClick={onMore}>
        <Gi icon={Ellipsis} size={19} />
        <span>More</span>
      </button>
    </nav>
  );
}
