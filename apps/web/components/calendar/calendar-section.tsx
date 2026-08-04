"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  CircleAlert,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { calendarSourcesQueryOptions } from "@/lib/calendar/query-options";
import { MiniMonth } from "./mini-month";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { useCalendarFocusRefresh } from "./use-calendar-focus-refresh";
import type { ConnectionRow } from "@/lib/calendar/types";

const PROVIDER_LABEL = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
} as const;

/**
 * Secondary-sidebar content for Calendar: focus-date mini month, view
 * toggle, the show/hide list of calendars, and "Connect …" CTAs for
 * Google/Outlook. Toggling a calendar updates a client-side preferences
 * context (`useCalendarPrefs`) — the grid filters off that set with no
 * round-trip.
 */
export function CalendarSection({ propertyId }: { propertyId: string }) {
  const sourcesQuery = useQuery(calendarSourcesQueryOptions());
  const { focusDate, setFocusDate, hiddenSources, toggleSource, view, setView } =
    useCalendarPrefs();
  const [connecting, setConnecting] = useState<"google" | "microsoft" | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();

  const connections = sourcesQuery.data?.connections ?? [];
  const sources = sourcesQuery.data?.sources ?? [];
  const hasGoogle = connections.some((c) => c.provider === "google");
  const hasMicrosoft = connections.some((c) => c.provider === "microsoft");

  // Auto-refresh external events every 5 min while the calendar tab is
  // focused. We don't poll continuously; tab focus is the right signal
  // because external changes that happened while the user was elsewhere
  // are the ones that matter when they come back.
  useCalendarFocusRefresh(propertyId, connections);

  function startConnect(provider: "google" | "microsoft") {
    setConnecting(provider);
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/api/calendar/${provider}/connect?next=${next}`;
  }

  async function refreshAll() {
    if (connections.length === 0) return;
    setRefreshing(true);
    const results = await Promise.allSettled(
      connections.map((c) =>
        fetch(`/api/calendar/${c.provider}/sync?connectionId=${c.id}`, {
          method: "POST",
        }),
      ),
    );
    setRefreshing(false);
    const failures = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
    ).length;
    if (failures > 0) toast.error(`${failures} sync(s) failed`);
    else toast.success("Calendars refreshed");
    qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    qc.invalidateQueries({ queryKey: ["calendar-sources"] });
  }

  async function disconnect(connection: ConnectionRow) {
    if (
      !confirm(
        `Disconnect ${connection.account_email}? Events from this account will be removed.`,
      )
    ) {
      return;
    }
    const res = await fetch(
      `/api/me/calendar/connections/${connection.id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected");
    qc.invalidateQueries({ queryKey: ["calendar-sources"] });
    qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <MiniMonth value={focusDate} onChange={setFocusDate} />
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>View</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {(["day", "week", "month"] as const).map((v) => (
              <SidebarMenuItem key={v}>
                <SidebarMenuButton
                  isActive={view === v}
                  onClick={() => setView(v)}
                  tooltip={`${v[0].toUpperCase()}${v.slice(1)} view`}
                >
                  <CalendarIcon />
                  <span className="capitalize">{v}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Calendars</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {sources.map((s) => {
              const hidden = hiddenSources.has(s.id);
              return (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    onClick={() => toggleSource(s.id)}
                    tooltip={s.account_email ?? s.name}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        hidden && "opacity-30",
                      )}
                      style={{
                        backgroundColor: s.color ? `#${s.color}` : undefined,
                      }}
                    />
                    <span className={cn("truncate", hidden && "opacity-40")}>
                      {s.name}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Accounts</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-1 px-2 pb-2">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5"
              >
                {c.last_sync_error ? (
                  <CircleAlert className="size-4 shrink-0 text-warning" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                )}
                <div className="flex-1 truncate">
                  <div className="truncate text-sm font-medium text-secondary-ink">
                    {c.account_email}
                  </div>
                  <div className="truncate text-xs text-faint-foreground">
                    {PROVIDER_LABEL[c.provider]}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Connection options"
                        className="rounded-md p-1 text-faint-foreground transition-colors hover:bg-accent-pressed hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={refreshAll} disabled={refreshing}>
                      <RefreshCw className="size-3.5" /> Refresh now
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => disconnect(c)}
                      className="text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            <ConnectButton
              provider="google"
              connected={hasGoogle}
              busy={connecting === "google"}
              onClick={() => startConnect("google")}
            />
            <ConnectButton
              provider="microsoft"
              connected={hasMicrosoft}
              busy={connecting === "microsoft"}
              onClick={() => startConnect("microsoft")}
            />
            {connections.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshAll}
                disabled={refreshing}
                className="justify-start"
              >
                <RefreshCw
                  className={cn("size-4", refreshing && "animate-spin")}
                />
                {refreshing ? "Refreshing…" : "Refresh now"}
              </Button>
            ) : null}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function ConnectButton({
  provider,
  connected,
  busy,
  onClick,
}: {
  provider: "google" | "microsoft";
  connected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-start gap-2"
      onClick={onClick}
      disabled={busy}
    >
      <Plus className="size-4" />
      <span className="truncate text-left">
        {connected
          ? `Add another ${PROVIDER_LABEL[provider]}`
          : `Connect ${PROVIDER_LABEL[provider]}`}
      </span>
    </Button>
  );
}
