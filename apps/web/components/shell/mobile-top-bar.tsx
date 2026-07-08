"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
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
import type { Membership } from "@/lib/auth/session";

type User = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Mobile navigation (below `md:`): a slim top bar on the outer shell surface
 * with a hamburger that opens the full LeftShell (icon rail + section
 * sidebar) in a left drawer. Desktop never renders this — the rail and
 * sidebar sit inline there.
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
  // and rail pushState section swaps both land here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname, section]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open navigation" />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[19rem] max-w-[85vw] gap-0 bg-sidebar p-0"
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
      <span className="min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
        {propertyName}
      </span>
    </header>
  );
}
