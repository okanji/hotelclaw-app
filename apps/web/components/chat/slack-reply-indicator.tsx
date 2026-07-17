"use client";

import { useMemo } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { UserResponse } from "stream-chat";
import { cn } from "@/lib/utils";

type Props = {
  replyCount: number;
  participants: UserResponse[] | undefined;
  lastReplyAt: string | Date | null | undefined;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

const MAX_VISIBLE_AVATARS = 4;

function initialsFor(name: string | null | undefined, id: string | undefined): string {
  const source = (name ?? id ?? "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  const built = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return built || source[0]!.toUpperCase();
}

// Slack uses short relative phrases ("14 days ago", "2 hours ago", "just now").
// Intl.RelativeTimeFormat is built into the platform, so no date library needed.
function formatRelative(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffSec = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(Math.round(diffSec), "second");
  const min = diffSec / 60;
  if (Math.abs(min) < 60) return rtf.format(Math.round(min), "minute");
  const hr = min / 60;
  if (Math.abs(hr) < 24) return rtf.format(Math.round(hr), "hour");
  const day = hr / 24;
  if (Math.abs(day) < 30) return rtf.format(Math.round(day), "day");
  const mo = day / 30;
  if (Math.abs(mo) < 12) return rtf.format(Math.round(mo), "month");
  return rtf.format(Math.round(day / 365), "year");
}

// Small square-rounded avatar in the reply indicator. Slack uses a *tighter*
// corner radius here than on full-size message avatars — keeping the same 8px
// as the 36px avatar looks too round at 24px. Hardcoded 3px instead of pulling
// from --slack-avatar-radius.
function ParticipantAvatar({ user }: { user: UserResponse }) {
  const label = (user.name ?? user.id ?? "").trim();
  if (user.image) {
    // eslint-disable-next-line @next/next/no-img-element -- Stream user images are remote and avatar sizes are tiny; an Image-component round-trip isn't worth it.
    return (
      <img
        src={user.image}
        alt={label}
        width={24}
        height={24}
        className="size-6 rounded-[5px] object-cover"
      />
    );
  }
  return (
    <div
      aria-label={label || undefined}
      className="flex size-6 items-center justify-center rounded-[5px] bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initialsFor(user.name, user.id)}
    </div>
  );
}

function OverflowChip({ count }: { count: number }) {
  return (
    <div className="flex size-6 items-center justify-center rounded-[5px] bg-muted text-xs font-semibold text-muted-foreground">
      +{count}
    </div>
  );
}

export function SlackReplyIndicator({
  replyCount,
  participants,
  lastReplyAt,
  onClick,
}: Props) {
  const visibleParticipants = useMemo(
    () => (participants ?? []).slice(0, MAX_VISIBLE_AVATARS),
    [participants],
  );
  const overflowCount = Math.max(
    0,
    (participants?.length ?? 0) - MAX_VISIBLE_AVATARS,
  );

  const replyLabel = replyCount === 1 ? "1 reply" : `${replyCount} replies`;

  const relative = useMemo(() => {
    if (!lastReplyAt) return null;
    const d = lastReplyAt instanceof Date ? lastReplyAt : new Date(lastReplyAt);
    if (Number.isNaN(d.getTime())) return null;
    return { iso: d.toISOString(), text: `Last reply ${formatRelative(d)}` };
  }, [lastReplyAt]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${replyLabel}${relative ? `, ${relative.text}` : ""}, view thread`}
      className={cn(
        "str-chat__slack-reply-indicator",
        // ~2/3 of the message column width (matches Slack desktop — the
        // indicator stretches but doesn't span the full bubble). Chevron is
        // pushed to the trailing edge via `ml-auto`.
        "group/reply-indicator flex w-2/3 max-w-full items-center gap-2 rounded-md text-left",
        "border border-transparent bg-transparent p-1",
        "transition-colors duration-100",
        "hover:border-border hover:bg-[var(--str-chat__background-core-surface-subtle,rgba(255,255,255,0.04))]",
        "focus-visible:border-border focus-visible:bg-[var(--str-chat__background-core-surface-subtle,rgba(255,255,255,0.04))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      {visibleParticipants.length > 0 ? (
        <div className="flex items-center gap-0.5">
          {visibleParticipants.map((p, idx) => (
            <ParticipantAvatar key={p.id ?? `p-${idx}`} user={p} />
          ))}
          {overflowCount > 0 ? <OverflowChip count={overflowCount} /> : null}
        </div>
      ) : null}

      <span className="text-sm font-semibold text-[color:var(--str-chat__text-link,var(--primary))] group-hover/reply-indicator:underline">
        {replyLabel}
      </span>

      {/* Slack swaps "Last reply X ago" for "View thread" on hover. We always
          render both and toggle visibility so the row width stays stable. */}
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        <span aria-hidden className="group-hover/reply-indicator:hidden group-focus-visible/reply-indicator:hidden">
          {relative?.text ?? ""}
        </span>
        <span
          aria-hidden
          className="hidden group-hover/reply-indicator:inline group-focus-visible/reply-indicator:inline"
        >
          View thread
        </span>
      </span>

      <ChevronRightIcon
        aria-hidden
        className={cn(
          "ml-auto size-3.5 shrink-0 text-muted-foreground",
          "opacity-0 transition-opacity duration-100",
          "group-hover/reply-indicator:opacity-100 group-focus-visible/reply-indicator:opacity-100",
        )}
      />
    </button>
  );
}
