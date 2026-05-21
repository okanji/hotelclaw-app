"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  CircleAlert,
  Plus,
} from "lucide-react";
import { useState } from "react";
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

  const connections = sourcesQuery.data?.connections ?? [];
  const sources = sourcesQuery.data?.sources ?? [];
  const hasGoogle = connections.some((c) => c.provider === "google");
  const hasMicrosoft = connections.some((c) => c.provider === "microsoft");

  function startConnect(provider: "google" | "microsoft") {
    setConnecting(provider);
    // Hand off the browser — the callback comes back to /p/<id>/calendar.
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/api/calendar/${provider}/connect?next=${next}`;
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
                        "size-3 shrink-0 rounded-[3px] ring-1 ring-border",
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
        <SidebarGroupLabel>Connect</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2 pb-2">
            <ConnectButton
              provider="google"
              connected={hasGoogle}
              busy={connecting === "google"}
              onClick={() => startConnect("google")}
              errored={connections.find(
                (c) => c.provider === "google" && c.last_sync_error,
              )}
            />
            <ConnectButton
              provider="microsoft"
              connected={hasMicrosoft}
              busy={connecting === "microsoft"}
              onClick={() => startConnect("microsoft")}
              errored={connections.find(
                (c) => c.provider === "microsoft" && c.last_sync_error,
              )}
            />
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
  errored,
}: {
  provider: "google" | "microsoft";
  connected: boolean;
  busy: boolean;
  onClick: () => void;
  errored?: { last_sync_error: string | null };
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-start gap-2"
      onClick={onClick}
      disabled={busy}
    >
      {connected ? (
        errored?.last_sync_error ? (
          <CircleAlert className="size-4 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-500" />
        )
      ) : (
        <Plus className="size-4" />
      )}
      <span className="truncate text-left">
        {connected ? `Reconnect ${PROVIDER_LABEL[provider]}` : `Connect ${PROVIDER_LABEL[provider]}`}
      </span>
    </Button>
  );
}
