"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarPlus,
  ChevronDown,
  Hash,
  Repeat,
  Search,
  Users,
  Video,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/badge-glyphs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shell/page-header";
import { EventDialog } from "@/components/calendar/event-dialog";
import { useMeeting } from "@/lib/stream/meeting-context";
import {
  groupMeetings,
  matchesMeetingQuery,
  stateBadge,
  type MeetingState,
} from "@/lib/meetings/status";
import type { MeetingListItem } from "@/lib/meetings/queries";
import { JoinMeetingButton } from "./join-meeting-button";

export type MeetingChannelOption = { streamChannelId: string; name: string };

type Row = MeetingListItem & { state: MeetingState };

/** Next half hour, 30 minutes long — the create default the calendar uses. */
function defaultSlot(): { start: Date; end: Date } {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
  return { start, end: new Date(start.getTime() + 30 * 60_000) };
}

/**
 * The meetings index — Upcoming / Live / Past over every `meetings` row, with
 * search. Lifecycle is decided by `lib/meetings/status.ts` (pure, tested), so
 * an abandoned call or a transcript that never came reads as what it is
 * instead of a perpetual "Processing…".
 *
 * Both creation paths are the EXISTING ones: "Schedule" opens the calendar's
 * `EventDialog` (→ `saveMeeting`), "Start" calls the meeting provider's
 * `start({channelId})` (→ `/api/meetings/start`) — the same as the channel
 * header's Meet button.
 */
export function MeetingsIndex({
  propertyId,
  currentUserId,
  meetings,
  channels,
  headerActions,
}: {
  propertyId: string;
  currentUserId: string;
  meetings: MeetingListItem[];
  channels: MeetingChannelOption[];
  /** Server-rendered header extras (Automations, Import transcript). */
  headerActions?: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [scheduleSlot, setScheduleSlot] = useState<{ start: Date; end: Date } | null>(
    null,
  );

  // `?schedule=1` (the sidebar's "Schedule meeting") opens the dialog once,
  // then strips itself so a refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("schedule") !== "1") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("schedule");
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL intent
    setScheduleSlot(defaultSlot());
  }, [searchParams]);

  // A ticking clock: rows cross Upcoming → Now → Past while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const groups = useMemo(() => {
    const filtered = meetings.filter((m) => matchesMeetingQuery(m, query));
    return groupMeetings(filtered, now);
  }, [meetings, query, now]);

  const total = groups.live.length + groups.upcoming.length + groups.past.length;
  const searching = query.trim().length > 0;

  const scheduleButton = (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={() => setScheduleSlot(defaultSlot())}
    >
      <Gi icon={CalendarPlus} size={14} />
      Schedule meeting
    </button>
  );
  const startButton = (
    <StartMeetingMenu channels={channels} onStarted={() => router.refresh()} />
  );

  const counts = [
    groups.live.length ? `${groups.live.length} live` : null,
    `${groups.upcoming.length} upcoming`,
    `${groups.past.length} past`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Meetings"
        icon={<Video />}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <div className="hide-m row" style={{ gap: 6 }}>
              {headerActions}
            </div>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1080 }}>
          <div className="ph">
            <div>
              <h1>Meetings</h1>
              <p>{meetings.length === 0 ? "Calls, schedules and AI notes" : counts}</p>
            </div>
            <div className="acts">
              {startButton}
              {scheduleButton}
            </div>
          </div>

          <div className="row" style={{ marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
            <div className="inwrap">
              <Gi icon={Search} size={13} />
              <input
                className="input search-sm"
                style={{ width: 280 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title, #channel, or person"
                aria-label="Search meetings"
              />
            </div>
          </div>

          {meetings.length === 0 ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={Video} />
                </div>
                <h3 className="es-h">No meetings yet</h3>
                <p>
                  Start a call in a channel now, or put one on the calendar. Recorded
                  meetings get a transcript and AI notes here.
                </p>
                <div className="row" style={{ gap: 6 }}>
                  {startButton}
                  {scheduleButton}
                </div>
              </div>
            </div>
          ) : searching && total === 0 ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={Search} />
                </div>
                <h3 className="es-h">No meetings match</h3>
                <p>
                  Nothing matches &ldquo;{query.trim()}&rdquo;. Try a title, a channel
                  name, or someone who spoke.
                </p>
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 18 }}>
              {groups.live.length > 0 ? (
                <MeetingGroup label="Live" count={groups.live.length}>
                  {groups.live.map((m) => (
                    <MeetingRow key={m.id} propertyId={propertyId} m={m} now={now} />
                  ))}
                </MeetingGroup>
              ) : null}

              {groups.upcoming.length > 0 || !searching ? (
                <MeetingGroup label="Upcoming" count={groups.upcoming.length}>
                  {groups.upcoming.length === 0 ? (
                    <div className="panel-b faint" style={{ paddingTop: 12, fontSize: 13 }}>
                      Nothing scheduled.{" "}
                      <button
                        type="button"
                        className="muted"
                        style={{ textDecoration: "underline", textUnderlineOffset: 2 }}
                        onClick={() => setScheduleSlot(defaultSlot())}
                      >
                        Schedule a meeting
                      </button>
                    </div>
                  ) : (
                    groups.upcoming.map((m) => (
                      <MeetingRow key={m.id} propertyId={propertyId} m={m} now={now} />
                    ))
                  )}
                </MeetingGroup>
              ) : null}

              {groups.past.length > 0 ? (
                <MeetingGroup label="Past" count={groups.past.length}>
                  {groups.past.map((m) => (
                    <MeetingRow key={m.id} propertyId={propertyId} m={m} now={now} />
                  ))}
                </MeetingGroup>
              ) : null}
            </div>
          )}

          {scheduleSlot ? (
            <EventDialog
              propertyId={propertyId}
              currentUserId={currentUserId}
              open
              onOpenChange={(open) => {
                if (!open) setScheduleSlot(null);
              }}
              initial={{ mode: "create", start: scheduleSlot.start, end: scheduleSlot.end }}
              onMutated={() => router.refresh()}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** gr8r `.day-h`-style group label over a `.panel` of `.nrow`s. */
function MeetingGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="row" style={{ gap: 6, margin: "0 2px 8px" }}>
        <span className="eyebrow">{label}</span>
        <span className="faint" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
      </div>
      <div className="panel" role="list" style={{ overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

function MeetingRow({
  propertyId,
  m,
  now,
}: {
  propertyId: string;
  m: Row;
  now: number;
}) {
  const badge = stateBadge(m.state);
  const joinable =
    m.state.phase === "live" && m.stream_call_type === "default";
  const people =
    m.speakers.length > 0
      ? m.speakers.map((s) => s.name).join(", ")
      : m.attendee_count > 1
        ? `${m.attendee_count} invited`
        : null;
  const duration =
    m.duration_seconds ??
    (m.state.phase === "past" && m.ended_at && m.scheduled_start === null
      ? Math.max(
          0,
          Math.round(
            (new Date(m.ended_at).getTime() - new Date(m.state.startAt).getTime()) / 1000,
          ),
        )
      : null);

  return (
    <div role="listitem" className="nrow" style={{ position: "relative", alignItems: "center" }}>
      <DateTile iso={m.state.startAt} live={m.state.phase === "live"} />
      <div className="grow" style={{ fontSize: 13 }}>
        <Link
          href={`/p/${propertyId}/meetings/${m.id}`}
          className="trunc after:absolute after:inset-0 after:content-['']"
          style={{ display: "block", fontWeight: 500, color: "var(--g8-text)" }}
        >
          {m.title}
        </Link>
        <div
          className="faint row trunc"
          style={{ fontSize: 11.5, marginTop: 3, gap: 5, flexWrap: "nowrap" }}
        >
          <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {whenLabel(m.state, now)}
          </span>
          {m.recurrence ? (
            <span className="row" style={{ gap: 2, flexShrink: 0 }} title="Repeats">
              <Gi icon={Repeat} size={11} />
            </span>
          ) : null}
          {m.channel_name ? (
            <span className="row" style={{ gap: 2, flexShrink: 0 }}>
              · <Gi icon={Hash} size={11} />
              {m.channel_name}
            </span>
          ) : null}
          {duration ? <span style={{ flexShrink: 0 }}>· {formatDuration(duration)}</span> : null}
          {people ? (
            <span className="row trunc" style={{ gap: 3 }}>
              · <Gi icon={Users} size={11} />
              <span className="trunc">{people}</span>
            </span>
          ) : m.host_name ? (
            <span className="trunc">· by {m.host_name}</span>
          ) : null}
        </div>
      </div>
      {/* Above the stretched link so the controls stay clickable. */}
      <div className="row" style={{ position: "relative", zIndex: 1, gap: 8, flexShrink: 0 }}>
        <G8Badge tone={badge.tone} title={badge.hint}>
          {badge.label}
        </G8Badge>
        {joinable ? (
          <JoinMeetingButton
            meetingId={m.id}
            callId={m.stream_call_id}
            callType={m.stream_call_type}
            size="xs"
          />
        ) : null}
      </div>
    </div>
  );
}

/** gr8r calendar-tile date chip (month eyebrow over the day number). */
function DateTile({ iso, live }: { iso: string; live?: boolean }) {
  const d = new Date(iso);
  return (
    <div
      className="col"
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--g8-r-sm)",
        border: "1px solid var(--g8-border)",
        background: live ? "var(--g8-accent-soft)" : "var(--g8-surface-2)",
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: live ? "var(--g8-accent)" : "var(--g8-text-3)",
        }}
      >
        {d.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span
        style={{
          marginTop: 2,
          fontSize: 14,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: "var(--g8-text)",
        }}
      >
        {d.getDate()}
      </span>
    </div>
  );
}

/**
 * Channel picker → the provider's walk-up `start`. A meeting is always tied
 * to a channel (that's where its summary posts back), so the page can't start
 * one without asking which.
 */
function StartMeetingMenu({
  channels,
  onStarted,
}: {
  channels: MeetingChannelOption[];
  onStarted: () => void;
}) {
  const { start, videoReady, stage } = useMeeting();
  const disabled = !videoReady || stage === "preparing" || channels.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={(props) => (
          <button
            {...props}
            type="button"
            className="btn btn-secondary btn-sm"
            title={
              !videoReady
                ? "Video not ready yet"
                : channels.length === 0
                  ? "Create a channel first — meetings post their notes to one"
                  : "Start a call now"
            }
          >
            <Gi icon={Video} size={14} />
            Start meeting
            <Gi icon={ChevronDown} size={12} className="faint" />
          </button>
        )}
      />
      <DropdownMenuContent align="end" sideOffset={4} className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Start in a channel</DropdownMenuLabel>
          {channels.map((c) => (
            <DropdownMenuItem
              key={c.streamChannelId}
              onClick={() => {
                void start({ channelId: c.streamChannelId }).then(onStarted);
              }}
            >
              <Hash className="text-faint-foreground" />
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function whenLabel(state: MeetingState, now: number): string {
  const start = new Date(state.startAt);
  const end = state.endAt ? new Date(state.endAt) : null;
  const day = dayLabel(start, now);
  const t = start.toLocaleTimeString(undefined, timeFmt);
  if (state.phase === "live") {
    return state.kind === "call" ? `Started ${t}` : `Now · ${t}${end ? `–${end.toLocaleTimeString(undefined, timeFmt)}` : ""}`;
  }
  if (state.phase === "upcoming") {
    return `${day} · ${t}${end ? `–${end.toLocaleTimeString(undefined, timeFmt)}` : ""}`;
  }
  return `${day} · ${t}`;
}

function dayLabel(d: Date, now: number): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOf(new Date(now));
  const diffDays = Math.round((startOf(d) - today) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: Math.abs(diffDays) < 7 ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

