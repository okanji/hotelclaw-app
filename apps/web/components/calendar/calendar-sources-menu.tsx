"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { calendarSourcesQueryOptions } from "@/lib/calendar/query-options";
import type { ConnectionRow } from "@/lib/calendar/types";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { useCalendarFocusRefresh } from "./use-calendar-focus-refresh";

const PROVIDER_LABEL = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
} as const;

/**
 * Toolbar "Calendars" popover — the show/hide checklist of every source
 * (meetings, tasks, bookings, each connected external calendar) plus the
 * connected accounts and Connect Google / Outlook. It used to be the
 * calendar sidebar body, which the one-tree shell hides behind the row's
 * chevron; page controls belong on the page. Toggling writes the client-side
 * prefs context, so the grid re-filters with no round-trip.
 *
 * Also owns the focus-driven external re-sync: the toolbar is mounted
 * whenever the calendar page is, the sidebar body is not.
 */
export function CalendarSourcesMenu({ propertyId }: { propertyId: string }) {
  const sourcesQuery = useQuery(calendarSourcesQueryOptions());
  const { hiddenSources, toggleSource } = useCalendarPrefs();
  const [connecting, setConnecting] = useState<"google" | "microsoft" | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();

  const connections = sourcesQuery.data?.connections ?? [];
  const sources = sourcesQuery.data?.sources ?? [];
  const hasGoogle = connections.some((c) => c.provider === "google");
  const hasMicrosoft = connections.some((c) => c.provider === "microsoft");
  const hiddenCount = sources.filter((s) => hiddenSources.has(s.id)).length;

  // Re-sync external events every 5 min while the tab is focused — the
  // changes that matter are the ones made while the user was elsewhere.
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
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Calendars">
            <Layers className="size-4" />
            Calendars
            {hiddenCount > 0 ? (
              <span className="text-xs text-faint-foreground tabular-nums">
                {sources.length - hiddenCount}/{sources.length}
              </span>
            ) : null}
            <ChevronDown className="size-3.5 text-faint-foreground" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-3">
        <div className="flex flex-col gap-1">
          <span className="px-1 text-xs leading-3 font-medium text-faint-foreground">
            Show on calendar
          </span>
          {sources.length === 0 ? (
            <span className="px-1 py-1.5 text-sm text-muted-foreground">
              {sourcesQuery.isPending ? "Loading…" : "No calendars"}
            </span>
          ) : null}
          {sources.map((s) => {
            const shown = !hiddenSources.has(s.id);
            return (
              <label
                key={s.id}
                title={s.account_email ?? s.name}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  checked={shown}
                  onCheckedChange={() => toggleSource(s.id)}
                />
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    !shown && "opacity-30",
                  )}
                  // Source colours are provider/user data, not theme tokens.
                  style={{
                    backgroundColor: s.color ? `#${s.color}` : undefined,
                  }}
                />
                <span
                  className={cn(
                    "truncate text-sm",
                    !shown && "text-muted-foreground",
                  )}
                >
                  {s.name}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 border-t border-border pt-2.5">
          <span className="px-1 text-xs leading-3 font-medium text-faint-foreground">
            Accounts
          </span>
          {connections.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md px-1 py-1.5"
            >
              {c.last_sync_error ? (
                <CircleAlert className="size-4 shrink-0 text-warning" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-success" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-secondary-ink">
                  {c.account_email}
                </div>
                <div className="truncate text-xs text-faint-foreground">
                  {PROVIDER_LABEL[c.provider]}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => disconnect(c)}
                aria-label={`Disconnect ${c.account_email}`}
                title="Disconnect"
              >
                <Trash2 className="size-3.5" />
              </Button>
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
      </PopoverContent>
    </Popover>
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
      variant="ghost"
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
