"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, Pin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TintIcon } from "@/components/ui/tint-card";
import { Gi } from "@/components/gr8r/icon";
import { NAV_APPS, NAV_GROUP_LABEL, type NavApp, type NavAppId } from "./nav-apps";

/**
 * The sidebar's "More" row → the app launcher (restored 2026-10-29 from the
 * pre-gr8r `app-launcher.tsx`, the grid people recognised — ClickUp's More,
 * Slack's "Agents & tools"): a popover beside the row with EVERY app as a
 * tile, grouped Work / Build & automate / Admin. Apps that have their own
 * sidebar row carry a small pin, so the grid also reads as "what's already in
 * my sidebar"; the rest (Meetings, Initiatives, Org chart) live only here.
 * The popover portals outside `.g8`, so it is Tailwind over our tokens.
 */
export function MoreLauncher({
  base,
  collapsed,
  inSidebar,
  active,
}: {
  base: string;
  collapsed: boolean;
  /** Apps with their own sidebar row — their tiles carry the pin. */
  inSidebar: ReadonlySet<NavAppId>;
  /** The current page is one of the More-only apps. */
  active: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = (["work", "build", "admin"] as const).map((g) => ({
    id: g,
    apps: NAV_APPS.filter((a) => a.group === g),
  }));

  function openApp(app: NavApp) {
    setOpen(false);
    router.push(`${base}${app.path}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={open || active ? "sitem on" : "sitem"}
            aria-label="More apps"
            title={collapsed ? "More" : undefined}
          />
        }
      >
        <Gi icon={Ellipsis} />
        <span className="trunc">More</span>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-[22rem] gap-3 p-3">
        {groups.map((g) => (
          <section key={g.id} className="flex flex-col gap-1.5">
            <h3 className="px-1 text-xs font-medium text-faint-foreground">
              {NAV_GROUP_LABEL[g.id]}
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {g.apps.map((app) => (
                <LauncherTile
                  key={app.id}
                  app={app}
                  pinned={inSidebar.has(app.id)}
                  onOpen={() => openApp(app)}
                />
              ))}
            </div>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LauncherTile({
  app,
  pinned,
  onOpen,
}: {
  app: NavApp;
  pinned: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={pinned ? `${app.hint} · in your sidebar` : app.hint}
      className="relative flex flex-col items-center gap-1.5 rounded-md px-1 py-2.5 text-xs text-secondary-ink outline-hidden transition-colors hover:bg-accent focus-visible:shadow-focus"
    >
      <TintIcon tone={app.tone}>
        <app.icon />
      </TintIcon>
      <span className="max-w-full truncate">{app.label}</span>
      {pinned ? (
        <Pin aria-hidden="true" className="absolute top-1.5 right-2 size-3 text-faint-foreground" />
      ) : null}
    </button>
  );
}
