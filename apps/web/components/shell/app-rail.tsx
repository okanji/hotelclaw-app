"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Grip,
  Home,
  LineChart,
  MessagesSquare,
  Sparkle,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { CloseSidebarIcon } from "./clickup-icons";
import { target } from "./nav-node";
import { MoreMenu, ON_RAIL } from "./more-launcher";
import { appForPath, NAV_APP_BY_ID, type NavAppId } from "./nav-apps";
import { RailPeek } from "./rail-peek";
import { useShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";
import {
  useLivePathname,
  useSectionNavigation,
} from "./use-section-navigation";

/**
 * Which sidebar the rail is showing. Derived from the route, never stored:
 * the rail button navigates into a section and the sidebar swaps to that
 * section's own navigation because the URL now says so. `home` is
 * everything that isn't one of the four dedicated sections.
 */
export type RailMode = "home" | "chat" | "docs" | "assistant" | "insights" | "automations";

export function railModeFor(base: string, pathname: string): RailMode {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const under = (p: string) => rest === p || rest.startsWith(`${p}/`);
  if (under("/assistant")) return "assistant";
  if (under("/home/insights")) return "insights";
  if (under("/workflows")) return "automations";
  if (under("/documents")) return "docs";
  if (under("/chat") || under("/dms") || under("/threads") || under("/inbox")) return "chat";
  return "home";
}

/**
 * Nav button: a stacked icon-tile + label. The whole button is the `group`;
 * only the inner tile carries the active/hover surface, so the label stays
 * legible. The tile holds the corner badges. Label weight never changes
 * between states — only its color.
 *
 * The rail runs under a scoped `dark` class with `--sidebar` pinned to
 * `--rail`, so every surface below is expressed in SIDEBAR TOKENS (warm
 * white-alpha on warm near-black) rather than hardcoded zinc/black alphas:
 * hover fill = `--sidebar-accent`, ink = `--sidebar-foreground`, active ink
 * = `--sidebar-accent-foreground`.
 */
const railItemClass =
  "group/item flex w-full flex-col items-center gap-1 rounded-md py-1.5 outline-hidden";
const railTileClass =
  "relative flex size-7 items-center justify-center rounded-md text-sidebar-accent-foreground transition-colors " +
  // One ink for every item, active or not — the full-contrast ink the
  // active item used to get (user request 2026-10-29): the marker bar below
  // is the ONLY selected-state signal. Hover keeps its fill.
  "group-hover/item:bg-sidebar-accent " +
  // Slack-style current marker: a rounded bar hugging the item's left edge
  // (the size-7 tile is centered in the 52px rail, so -left-3 lands the bar
  // at the rail's edge). `inset-y-0` pins it to exactly the tile's height so
  // bar and tile read as one aligned unit; active ink so it tracks the
  // sidebar tokens rather than a hardcoded white.
  "data-current:before:absolute data-current:before:inset-y-0 data-current:before:-left-3 " +
  "data-current:before:w-[3px] data-current:before:rounded-full " +
  "data-current:before:bg-sidebar-accent-foreground " +
  "group-focus-visible/item:shadow-focus";
// Weight 400, one full-contrast color for every item — selection is the
// marker bar only.
const railLabelClass =
  "block w-full truncate text-center text-xs leading-none font-normal text-sidebar-accent-foreground";
/** The rail glyph. 16px — the lighter mark reads quieter on the dark plane. */
const railIconClass = "size-4";
/** Quiet utility button — the ClickUp-style » at the rail's top while the
 *  sidebar is collapsed. Fill on hover only — no resting chrome. */
const railExpandButtonClass =
  "flex size-7 items-center justify-center rounded-md outline-hidden transition-colors " +
  "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground " +
  "focus-visible:shadow-focus";

/**
 * The app rail — the pre-gr8r icon rail's UI, brought back 2026-10-29 at
 * the user's request: a FLOATING near-black island inset by an m-2 gutter
 * that shows the chrome plane behind it (`LeftShell` paints bg-sidebar),
 * the card-tier radius and `shadow-card`, whose dark-scoped recipe ends in
 * a white-alpha rim so the pill keeps a lit edge in both themes. The scoped
 * `dark` class flips the token set for this subtree only; the inline style
 * then pins the subtree's --sidebar to the warm near-black --rail token.
 *
 * Home · Chat · Docs · AI · Insights · Automate each swap the sidebar beside the rail
 * to that section's own navigation (the sidebar body is picked by
 * `railModeFor` from the URL); More opens ClickUp's app launcher popover (the
 * org picker is on the global `TopBar`). While the sidebar is collapsed a
 * ClickUp-style » sits at the very top of the rail above a short divider
 * (ClickUp's collapsed rail, user request 2026-10-29) and brings it back;
 * collapsing is the « in the sidebar header. Hovering an item opens a
 * peek card (`rail-peek.tsx`) — the section's places and recent things —
 * so a channel, doc or conversation is one hop away without switching the
 * sidebar first. Guests get Home, Chat and Docs only — the rest are
 * outside `GUEST_SECTIONS`.
 */
export function AppRail({
  propertyId,
  userId,
  isGuest,
  isManagement,
}: {
  propertyId: string;
  userId: string;
  isGuest: boolean;
  isManagement: boolean;
}) {
  const base = `/p/${propertyId}`;
  const pathname = useLivePathname();
  const { navigate } = useSectionNavigation(propertyId);
  const { sidebarCollapsed, setSidebarCollapsed } = useShellSection();
  const { unseenCount } = useNotifications(userId);
  const mode = railModeFor(base, pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  // Which rail item's peek card is open. Controlled so a click closes it at
  // once (user request 2026-10-29) — the card is for hovering, not for
  // after you've chosen.
  const [peek, setPeek] = useState<RailMode | null>(null);
  // The item just clicked: its card stays shut until the pointer leaves it
  // (otherwise the still-hovering pointer re-opens it after navigation).
  const [clicked, setClicked] = useState<RailMode | null>(null);
  // An app picked from More sits on the rail (above More, lit) until you
  // navigate away from it (user request 2026-10-29) — ClickUp's temporary
  // rail item. `arrived` waits for the URL to reach the app first, so the
  // pick isn't dropped in the gap before the navigation lands.
  const [temp, setTemp] = useState<{ id: NavAppId; arrived: boolean } | null>(null);
  const here = appForPath(propertyId, pathname);
  if (temp && !temp.arrived && here === temp.id) setTemp({ ...temp, arrived: true });
  if (temp && temp.arrived && here !== temp.id) setTemp(null);
  const tempApp = temp ? NAV_APP_BY_ID.get(temp.id) : undefined;
  const tempActive = !!tempApp && here === temp?.id;
  // On a More-only app you reached some other way, More itself is lit.
  const moreActive = !tempActive && !!here && !ON_RAIL.has(here) && mode === "home";

  // Chat / Docs / Assistant / Insights resume their last path (pushState fast
  // path for the client-rendered sections).
  const targets = useMemo(
    () => ({
      home: target(base, "home", "/home", "/home"),
      chat: target(base, "chat", "/chat"),
      docs: target(base, "docs", "/documents", "/documents"),
      assistant: target(base, "assistant", "/assistant", "/assistant"),
      insights: target(base, "insights", "/home/insights", "/home/insights"),
      automations: target(base, "workflows", "/workflows", "/workflows"),
    }),
    [base],
  );

  const items: { key: RailMode; label: string; icon: LucideIcon; badge?: number }[] = [
    // Inbox lives in the Home sidebar, so its unseen count rides the Home tile.
    { key: "home", label: "Home", icon: Home, badge: unseenCount },
    { key: "chat", label: "Chat", icon: MessagesSquare },
    { key: "docs", label: "Docs", icon: FileText },
    // "AI", not "Assistant" — the full word is the rail's longest string and
    // single-handedly forced the old 68px width.
    ...(isGuest
      ? []
      : [
          { key: "assistant" as const, label: "AI", icon: Sparkle },
          // Management reads the property; staff get their personal "My week".
          { key: "insights" as const, label: isManagement ? "Insights" : "My week", icon: LineChart },
          // Workflows, under ClickUp's name for them.
          { key: "automations" as const, label: "Auto", icon: Workflow },
        ]),
  ];

  return (
    <TooltipProvider delay={0}>
      <aside
        className="dark m-2 flex w-(--rail-width) shrink-0 flex-col items-center rounded-card bg-sidebar px-0 pt-2 pb-3 shadow-card"
        style={{ "--sidebar": "var(--rail)" } as React.CSSProperties}
        aria-label="Sections"
      >
        {sidebarCollapsed ? (
          // ClickUp's collapsed rail: » on top, a short divider under it,
          // then the apps. Desktop only — the mobile drawer never collapses.
          <div className="mb-2 flex w-full flex-col items-center gap-2 max-md:hidden">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Open sidebar"
                    className={railExpandButtonClass}
                  />
                }
              >
                {/* ClickUp's closeLeft glyph, mirrored to point at the content. */}
                <CloseSidebarIcon className="size-4 -scale-x-100" />
              </TooltipTrigger>
              <TooltipContent side="right">
                Open sidebar
                <kbd className="ml-1.5 font-sans text-xs font-normal opacity-60">⌘\</kbd>
              </TooltipContent>
            </Tooltip>
            <span aria-hidden="true" className="h-px w-8 rounded-full bg-sidebar-accent-foreground/25" />
          </div>
        ) : null}

        {/* Icons flow top-to-bottom, not vertically centered. */}
        <nav className="no-scrollbar flex min-h-0 w-full flex-1 flex-col justify-start overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = mode === item.key && !moreActive && !tempActive;
              return (
                <li
                  key={item.key}
                  onPointerLeave={() => setClicked((c) => (c === item.key ? null : c))}
                >
                  <HoverCard
                    open={peek === item.key && clicked !== item.key}
                    onOpenChange={(open) =>
                      setPeek((cur) => (open ? item.key : cur === item.key ? null : cur))
                    }
                  >
                  <HoverCardTrigger
                    delay={350}
                    closeDelay={120}
                    render={
                      <button
                        type="button"
                        onClick={() => {
                          setPeek(null);
                          setClicked(item.key);
                          navigate(targets[item.key]);
                        }}
                        aria-label={item.label}
                        aria-current={isActive ? "page" : undefined}
                        className={railItemClass}
                      />
                    }
                  >
                    <span
                      {...(isActive ? { "data-current": "" } : {})}
                      className={railTileClass}
                    >
                      <Icon className={railIconClass} strokeWidth={1.75} />
                      {item.badge ? (
                        // Lavender count badge punched onto the icon's
                        // top-right corner. `ring-sidebar` resolves to the
                        // rail surface, giving the cutout look; the ink is
                        // the constant tint-fill ink, dark-on-lavender in
                        // both themes.
                        <span className="absolute -top-1 -right-1 z-10 flex h-4 min-w-4 animate-in zoom-in-50 items-center justify-center rounded-full bg-brand-accent px-1 text-xs leading-none font-medium text-cover-ink tabular-nums ring-2 ring-sidebar duration-200">
                          {item.badge > 9 ? "9+" : item.badge}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        railLabelClass,
                      )}
                    >
                      {item.label}
                    </span>
                  </HoverCardTrigger>
                  {/* Portaled out of `.g8`, so it re-roots gr8r's scope for
                      the `.sitem` rows inside. */}
                  <HoverCardContent
                    side="right"
                    align="start"
                    sideOffset={6}
                    className="g8 g8-port w-[16.5rem] p-1.5"
                  >
                    <RailPeek
                      mode={item.key}
                      propertyId={propertyId}
                      userId={userId}
                      isManagement={isManagement}
                    />
                  </HoverCardContent>
                  </HoverCard>
                </li>
              );
            })}

            {isGuest ? null : (
              <>
              {tempApp ? (
                <li>
                  <button
                    type="button"
                    onClick={() => navigate({ section: tempApp.section ?? "home", href: `${base}${tempApp.path}` })}
                    aria-label={tempApp.label}
                    aria-current={tempActive ? "page" : undefined}
                    className={railItemClass}
                  >
                    <span
                      {...(tempActive ? { "data-current": "" } : {})}
                      className={railTileClass}
                    >
                      <tempApp.icon className={railIconClass} />
                    </span>
                    <span className={railLabelClass}>{tempApp.label}</span>
                  </button>
                </li>
              ) : null}
              <li>
                <MoreMenu
                  base={base}
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  onPick={(app) => setTemp({ id: app.id, arrived: false })}
                  trigger={
                <button
                  type="button"
                  aria-label="More"
                  aria-current={moreActive ? "page" : undefined}
                  className={railItemClass}
                >
                  <span
                    {...(moreActive || moreOpen ? { "data-current": "" } : {})}
                    className={railTileClass}
                  >
                    {/* ClickUp's More: a 3×3 dot grid (app launcher), not an ellipsis. */}
                    <Grip className={railIconClass} strokeWidth={1.75} />
                  </span>
                  <span
                    className={cn(
                      railLabelClass,
                    )}
                  >
                    More
                  </span>
                </button>
                  }
                />
              </li>
              </>
            )}
          </ul>
        </nav>

      </aside>
    </TooltipProvider>
  );
}
