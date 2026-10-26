"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TintIcon } from "@/components/ui/tint-card";
import { CountBadge } from "@/components/ui/count-badge";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { MoreIcon } from "./clickup-icons";
import {
  NAV_APPS,
  NAV_APP_BY_ID,
  type NavApp,
  type NavAppId,
} from "./nav-apps";
import type { NavSectionId, useNavPrefs } from "./use-nav-prefs";

export type NavBadges = Partial<Record<NavAppId, { count?: number; dot?: boolean }>>;
type Prefs = ReturnType<typeof useNavPrefs>;

/**
 * The sidebar's "More" row — Linear's: a small menu dropping BELOW the row
 * with only the apps that aren't already in the sidebar, then "Customize
 * sidebar". (It used to be a ClickUp-style grid of every app, which repeated
 * what the sidebar already showed.) Section apps resume where you left off.
 */
export function AppLauncher({
  prefs,
  badges,
  onOpenApp,
}: {
  prefs: Prefs;
  badges: NavBadges;
  /** Navigate to an app (the sidebar owns section resume + routing). */
  onOpenApp: (app: NavApp) => void;
}) {
  const [customizing, setCustomizing] = useState(false);
  const unpinned = NAV_APPS.filter((a) => !prefs.pins.includes(a.id));

  // Something needs attention in an app you can't see in the sidebar.
  const hiddenAlert = unpinned.some((a) => {
    const b = badges[a.id];
    return !!b && (!!b.dot || (b.count ?? 0) > 0);
  });

  return (
    <>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton aria-label="More apps" tooltip="More apps" />}
          >
            <MoreIcon />
            <span className="flex-1">More</span>
            {hiddenAlert ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {unpinned.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                Every app is in your sidebar.
              </p>
            ) : (
              unpinned.map((app) => {
                const b = badges[app.id];
                const count = b?.count ?? 0;
                return (
                  <DropdownMenuItem key={app.id} onClick={() => onOpenApp(app)} title={app.hint}>
                    <app.icon />
                    <span className="flex-1 truncate">{app.label}</span>
                    {count > 0 ? (
                      <CountBadge tone="warning">{count > 99 ? "99+" : count}</CountBadge>
                    ) : b?.dot ? (
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCustomizing(true)}>
              <Settings2 />
              Customize sidebar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <CustomizeNavDialog open={customizing} onOpenChange={setCustomizing} prefs={prefs} />
    </>
  );
}

const SECTION_ROWS: { id: NavSectionId; label: string; hint: string }[] = [
  { id: "favorites", label: "Favorites", hint: "Starred documents" },
  { id: "teams", label: "Teams", hint: "Your departments and their views" },
  { id: "projects", label: "Projects", hint: "Active projects and their views" },
];

/**
 * ClickUp's "Customize navigation" / Slack's "Customize tabs": choose which
 * apps sit in the sidebar (and their order) and which lower groups show.
 * Everything unpinned stays one click away under More.
 */
export function CustomizeNavDialog({
  open,
  onOpenChange,
  prefs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: Prefs;
}) {
  const pinned = prefs.pins
    .map((id) => NAV_APP_BY_ID.get(id))
    .filter((a): a is NavApp => !!a);
  const unpinned = NAV_APPS.filter((a) => !prefs.pins.includes(a.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-medium">Customize sidebar</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Pin the apps you use every day. Everything else stays under More.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-x-hidden overflow-y-auto pr-1">
          <section className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-faint-foreground">In the sidebar</h3>
            {pinned.length === 0 ? (
              <p className="px-1 py-2 text-sm text-pretty text-muted-foreground">
                Nothing pinned — every app is under More.
              </p>
            ) : (
              pinned.map((app, i) => (
                <AppRow key={app.id} app={app} pinned onToggle={() => prefs.togglePin(app.id)}>
                  <IconButton
                    label={`Move ${app.label} up`}
                    disabled={i === 0}
                    onClick={() => prefs.movePin(app.id, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`Move ${app.label} down`}
                    disabled={i === pinned.length - 1}
                    onClick={() => prefs.movePin(app.id, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                </AppRow>
              ))
            )}
          </section>

          {unpinned.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="px-1 text-xs font-medium text-faint-foreground">Under More</h3>
              {unpinned.map((app) => (
                <AppRow key={app.id} app={app} pinned={false} onToggle={() => prefs.togglePin(app.id)} />
              ))}
            </section>
          ) : null}

          <section className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-faint-foreground">Sidebar groups</h3>
            {SECTION_ROWS.map((row) => (
              <label
                key={row.id}
                className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{row.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.hint}</span>
                </span>
                <Switch
                  checked={!prefs.hidden.includes(row.id)}
                  onCheckedChange={() => prefs.toggleSection(row.id)}
                  aria-label={`Show ${row.label}`}
                />
              </label>
            ))}
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={prefs.reset} disabled={!prefs.customized}>
            Reset to default
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppRow({
  app,
  pinned,
  onToggle,
  children,
}: {
  app: NavApp;
  pinned: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent">
      <TintIcon tone={app.tone} className="size-7">
        <app.icon />
      </TintIcon>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{app.label}</span>
        <span className="truncate text-xs text-muted-foreground">{app.hint}</span>
      </span>
      {children}
      <Switch checked={pinned} onCheckedChange={onToggle} aria-label={`Pin ${app.label}`} />
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-accent-pressed focus-visible:shadow-focus disabled:opacity-30 [&_svg]:size-3.5",
      )}
    >
      {children}
    </button>
  );
}
