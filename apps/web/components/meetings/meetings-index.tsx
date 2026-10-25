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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/ui/page-shell";
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
    <Button size="sm" onClick={() => setScheduleSlot(defaultSlot())}>
      <CalendarPlus />
      Schedule meeting
    </Button>
  );
  const startButton = (
    <StartMeetingMenu channels={channels} onStarted={() => router.refresh()} />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Meetings"
        icon={<Video />}
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">{headerActions}</div>
            {startButton}
            {scheduleButton}
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto pt-2 pb-12">
        {/* One width for the page — search, groups, and empty states share it. */}
        <PageShell className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title, #channel, or person"
                aria-label="Search meetings"
                className="pl-7"
              />
            </div>
          </div>

          {meetings.length === 0 ? (
            <EmptyState
              icon={Video}
              title="No meetings yet"
              action={
                <div className="flex items-center gap-2">
                  {startButton}
                  {scheduleButton}
                </div>
              }
            >
              Start a call in a channel now, or put one on the calendar. Recorded
              meetings get a transcript and AI notes here.
            </EmptyState>
          ) : searching && total === 0 ? (
            <EmptyState icon={Search} title="No meetings match">
              Nothing matches &ldquo;{query.trim()}&rdquo;. Try a title, a channel
              name, or someone who spoke.
            </EmptyState>
          ) : (
            <>
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
                    <p className="px-2 py-2 text-sm text-faint-foreground">
                      Nothing scheduled.{" "}
                      <button
                        type="button"
                        className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => setScheduleSlot(defaultSlot())}
                      >
                        Schedule a meeting
                      </button>
                    </p>
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
            </>
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
        </PageShell>
      </div>
    </div>
  );
}

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
      <h2 className="flex items-baseline gap-2 px-2 pb-1 text-xs leading-3 font-medium text-faint-foreground">
        {label}
        <span className="tabular-nums">{count}</span>
      </h2>
      <ul role="list" className="flex flex-col">
        {children}
      </ul>
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
    <li className="group relative flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
      <DateTile iso={m.state.startAt} />
      <div className="min-w-0 flex-1">
        <Link
          href={`/p/${propertyId}/meetings/${m.id}`}
          className="block truncate text-sm font-medium text-foreground after:absolute after:inset-0 after:content-['']"
        >
          {m.title}
        </Link>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">{whenLabel(m.state, now)}</span>
          {m.recurrence ? (
            <span className="flex shrink-0 items-center gap-0.5" title="Repeats">
              <Repeat className="size-3" />
            </span>
          ) : null}
          {m.channel_name ? (
            <span className="flex shrink-0 items-center gap-0.5">
              · <Hash className="size-3" />
              {m.channel_name}
            </span>
          ) : null}
          {duration ? <span className="shrink-0">· {formatDuration(duration)}</span> : null}
          {people ? (
            <span className="flex min-w-0 items-center gap-1 truncate">
              · <Users className="size-3 shrink-0" />
              <span className="truncate">{people}</span>
            </span>
          ) : m.host_name ? (
            <span className="truncate">· by {m.host_name}</span>
          ) : null}
        </p>
      </div>
      {/* Above the stretched link so the controls stay clickable. */}
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        <span title={badge.hint}>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </span>
        {joinable ? (
          <JoinMeetingButton
            meetingId={m.id}
            callId={m.stream_call_id}
            callType={m.stream_call_type}
            size="xs"
          />
        ) : null}
      </div>
    </li>
  );
}

function DateTile({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="flex size-9 shrink-0 flex-col items-center justify-center rounded-md bg-muted leading-none">
      <span className="text-[10px] font-medium text-faint-foreground uppercase">
        {d.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
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
          <Button
            {...props}
            size="sm"
            variant="outline"
            title={
              !videoReady
                ? "Video not ready yet"
                : channels.length === 0
                  ? "Create a channel first — meetings post their notes to one"
                  : "Start a call now"
            }
          >
            <Video />
            Start meeting
            <ChevronDown className="size-3 text-faint-foreground" />
          </Button>
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

