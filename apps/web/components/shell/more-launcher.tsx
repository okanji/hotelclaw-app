"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TintTone } from "@/components/ui/tint-card";
import { NAV_APPS, type NavApp, type NavAppId } from "./nav-apps";

/**
 * Apps that are rail items — left out of the More grid (ClickUp's More only
 * lists what the rail doesn't already show).
 */
export const ON_RAIL: ReadonlySet<NavAppId> = new Set<NavAppId>(["home", "insights", "workflows"]);

/** Pastel tile fill + matching ink per tone (the brand tint palette). */
const TILE: Record<TintTone, string> = {
  lavender: "bg-tint-lavender text-tint-lavender-ink",
  blue: "bg-tint-blue text-tint-blue-ink",
  sage: "bg-tint-sage text-tint-sage-ink",
  coral: "bg-tint-coral text-tint-coral-ink",
  honey: "bg-tint-honey text-tint-honey-ink",
};

/**
 * The rail's "More" → ClickUp's app launcher (2026-10-29): a popover beside
 * the rail button, a soft gray frame around a white panel holding a 3-up
 * grid of pastel rounded-square icon tiles (tint palette) with labels
 * underneath, and "Customize navigation" (→ Settings › Sidebar) at the
 * foot. Lists every app the rail doesn't already carry; picking one tells
 * the rail (`onPick`) so it can sit there until you leave it. Portals
 * outside `.g8`, so it is Tailwind over our tokens.
 */
export function MoreMenu({
  base,
  open,
  onOpenChange,
  onPick,
  trigger,
}: {
  base: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (app: NavApp) => void;
  /** The rail button (rendered as the popover's trigger). */
  trigger: ReactElement;
}) {
  const router = useRouter();
  const apps = NAV_APPS.filter((a) => !ON_RAIL.has(a.id));

  function openApp(app: NavApp) {
    onOpenChange(false);
    onPick(app);
    router.push(`${base}${app.path}`);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        alignOffset={-8}
        className="w-[17.5rem] gap-0 rounded-[16px] bg-muted p-1.5"
      >
        <div className="flex flex-col gap-3 rounded-[12px] bg-surface px-2 pt-4 pb-1.5 ring-1 ring-border">
          <div className="grid grid-cols-3 gap-y-3">
            {apps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => openApp(app)}
                title={app.hint}
                className="group/tile flex flex-col items-center gap-1.5 rounded-md px-0.5 py-1 text-[13px] text-foreground outline-hidden focus-visible:shadow-focus"
              >
                <span
                  className={`flex size-10 items-center justify-center rounded-[10px] transition-[filter] group-hover/tile:brightness-95 ${TILE[app.tone]}`}
                >
                  <app.icon className="size-5" />
                </span>
                <span className="max-w-full truncate">{app.label}</span>
              </button>
            ))}
          </div>
          <Link
            href={`${base}/settings?sec=sidebar`}
            onClick={() => onOpenChange(false)}
            className="-mx-1 flex h-8 items-center justify-center gap-1.5 rounded-md text-[12.5px] text-muted-foreground transition-colors outline-hidden hover:bg-accent hover:text-foreground focus-visible:shadow-focus"
          >
            <Settings className="size-3.5" />
            Customize navigation
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
