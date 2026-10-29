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
import { Gi } from "@/components/gr8r/icon";
import { g8c } from "@/components/gr8r/calendar-glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
 * (meetings, tasks, each connected external calendar) plus the
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

  // gr8r chrome: a `.btn-ghost` toolbar trigger and a menu of `.mh`
  // headings, `.mi` rows (`.check` boxes, colour dots) and `.msep` rules.
  // The popup portals out of the shell, so it carries `g8 g8-port` itself.
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button type="button" className="btn btn-ghost" aria-label="Calendars">
            <Gi icon={Layers} size={14} />
            Calendars
            {hiddenCount > 0 ? (
              <span className="faint num">
                {sources.length - hiddenCount}/{sources.length}
              </span>
            ) : null}
            <Gi icon={ChevronDown} size={13} />
          </button>
        }
      />
      <PopoverContent align="end" className="g8 g8-port w-80 gap-0 p-1">
        <div className="mh">Show on calendar</div>
        {sources.length === 0 ? (
          <div className="mi faint" style={{ cursor: "default" }}>
            {sourcesQuery.isPending ? "Loading…" : "No calendars"}
          </div>
        ) : null}
        {sources.map((s) => {
          const shown = !hiddenSources.has(s.id);
          return (
            <label
              key={s.id}
              title={s.account_email ?? s.name}
              className="mi"
              style={{ cursor: "pointer" }}
            >
              <input
                type="checkbox"
                className="check"
                checked={shown}
                onChange={() => toggleSource(s.id)}
              />
              <span
                aria-hidden
                className="pdot"
                // Source colours are provider/user data, not theme tokens.
                style={g8c(s.color ? `#${s.color}` : "var(--g8-gray)", {
                  borderRadius: "50%",
                  opacity: shown ? 1 : 0.3,
                })}
              />
              <span className={shown ? "trunc" : "trunc faint"}>{s.name}</span>
            </label>
          );
        })}

        <div className="msep" />
        <div className="mh">Accounts</div>
        {connections.map((c) => (
          <div key={c.id} className="mi" style={{ minHeight: 40 }}>
            {c.last_sync_error ? (
              <span style={{ color: "var(--g8-amber)", display: "flex" }}>
                <Gi icon={CircleAlert} size={15} />
              </span>
            ) : (
              <span style={{ color: "var(--g8-green)", display: "flex" }}>
                <Gi icon={CheckCircle2} size={15} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block trunc">{c.account_email}</span>
              <span className="mi-sub trunc">{PROVIDER_LABEL[c.provider]}</span>
            </span>
            <button
              type="button"
              className="ibtn ibtn-xs"
              onClick={() => disconnect(c)}
              aria-label={`Disconnect ${c.account_email}`}
              title="Disconnect"
            >
              <Gi icon={Trash2} size={13} />
            </button>
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
          <button
            type="button"
            className="mi"
            onClick={refreshAll}
            disabled={refreshing}
          >
            <Gi
              icon={RefreshCw}
              size={14}
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        ) : null}
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
    <button type="button" className="mi" onClick={onClick} disabled={busy}>
      <Gi icon={Plus} size={14} />
      <span className="trunc">
        {connected
          ? `Add another ${PROVIDER_LABEL[provider]}`
          : `Connect ${PROVIDER_LABEL[provider]}`}
      </span>
    </button>
  );
}
