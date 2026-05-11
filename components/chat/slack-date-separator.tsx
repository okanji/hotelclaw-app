"use client";

import clsx from "clsx";
import { ChevronDownIcon } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import type { LocalMessage } from "stream-chat";
import {
  isDateSeparatorMessage,
  isIntroMessage,
  useChannelActionContext,
  useChannelStateContext,
} from "stream-chat-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function subDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

function startOfPreviousMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0);
}

function endOfPreviousMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
}

function formatPillLabel(messageDate: Date, now: Date, locale: string | undefined): string {
  const t0 = startOfDay(now).getTime();
  const t1 = startOfDay(messageDate).getTime();
  const diffDays = Math.round((t0 - t1) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return messageDate.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(messageDate.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function isRenderableChatMessage(m: LocalMessage): m is LocalMessage & { id: string } {
  return (
    !!m.id &&
    !isDateSeparatorMessage(m) &&
    !isIntroMessage(m) &&
    m.type !== "system" &&
    m.type !== "error"
  );
}

function firstMessageIdAtStartOfDay(
  messages: LocalMessage[] | undefined,
  day: Date,
): string | undefined {
  if (!messages?.length) return undefined;
  const start = startOfDay(day).getTime();
  const end = start + 86400000;
  for (const m of messages) {
    if (!isRenderableChatMessage(m)) continue;
    const c = m.created_at ? new Date(m.created_at) : null;
    if (!c || Number.isNaN(c.getTime())) continue;
    const t = c.getTime();
    if (t >= start && t < end) return m.id;
  }
  return undefined;
}

/** First real message on or after `boundary` (channel list is oldest → newest). */
function firstMessageIdOnOrAfter(
  messages: LocalMessage[] | undefined,
  boundary: Date,
): string | undefined {
  if (!messages?.length) return undefined;
  const b = boundary.getTime();
  for (const m of messages) {
    if (!isRenderableChatMessage(m)) continue;
    const c = m.created_at ? new Date(m.created_at) : null;
    if (!c || Number.isNaN(c.getTime())) continue;
    if (c.getTime() >= b) return m.id;
  }
  return undefined;
}

function firstRealMessageId(messages: LocalMessage[] | undefined): string | undefined {
  if (!messages?.length) return undefined;
  for (const m of messages) {
    if (isRenderableChatMessage(m)) return m.id;
  }
  return undefined;
}

export type SlackDateSeparatorProps = {
  /** Message / row date (Stream passes this for separator items). */
  date: Date;
  unread?: boolean;
  floating?: boolean;
  className?: string;
  formatDate?: (date: Date) => string;
  calendar?: boolean;
};

export const SlackDateSeparator = React.memo(function SlackDateSeparator({
  date,
  unread: _unread,
  floating,
  className,
  formatDate,
}: SlackDateSeparatorProps) {
  const { messages } = useChannelStateContext("SlackDateSeparator");
  const { jumpToLatestMessage, jumpToMessage } = useChannelActionContext("SlackDateSeparator");

  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");

  const locale = typeof navigator !== "undefined" ? navigator.language : undefined;

  const label = useMemo(() => {
    if (formatDate) return formatDate(date);
    return formatPillLabel(date, new Date(), locale);
  }, [date, formatDate, locale]);

  const runJump = useCallback(
    async (id: string | undefined) => {
      if (!id) return;
      await jumpToMessage(id);
    },
    [jumpToMessage],
  );

  const jumpToday = useCallback(async () => {
    await jumpToLatestMessage();
  }, [jumpToLatestMessage]);

  const jumpYesterday = useCallback(async () => {
    const day = subDays(startOfDay(new Date()), 1);
    const id = firstMessageIdAtStartOfDay(messages, day);
    await runJump(id);
  }, [messages, runJump]);

  const jumpLastWeek = useCallback(async () => {
    const boundary = startOfDay(subDays(new Date(), 7));
    const id = firstMessageIdOnOrAfter(messages, boundary);
    await runJump(id);
  }, [messages, runJump]);

  const jumpLastMonth = useCallback(async () => {
    const now = new Date();
    const start = startOfPreviousMonth(now);
    const end = endOfPreviousMonth(now);
    if (!messages?.length) return;
    for (const m of messages) {
      if (!isRenderableChatMessage(m)) continue;
      const c = m.created_at ? new Date(m.created_at) : null;
      if (!c || Number.isNaN(c.getTime())) continue;
      if (c >= start && c <= end) {
        await runJump(m.id);
        return;
      }
    }
  }, [messages, runJump]);

  const jumpBeginning = useCallback(async () => {
    const id = firstRealMessageId(messages);
    await runJump(id);
  }, [messages, runJump]);

  const openPickDate = useCallback(() => {
    const d = startOfDay(date);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    setPickedDate(`${y}-${mo}-${da}`);
    setDateDialogOpen(true);
  }, [date]);

  const confirmPickDate = useCallback(async () => {
    if (!pickedDate) return;
    const [ys, ms, ds] = pickedDate.split("-").map((x) => Number.parseInt(x, 10));
    if (!ys || !ms || !ds) return;
    const targetDay = new Date(ys, ms - 1, ds, 12, 0, 0, 0);
    const id = firstMessageIdAtStartOfDay(messages, targetDay);
    setDateDialogOpen(false);
    await runJump(id);
  }, [messages, pickedDate, runJump]);

  return (
    <>
      <div
        className={clsx(
          "str-chat__date-separator str-chat__slack-date-separator",
          { "str-chat__date-separator--floating": floating },
          className,
        )}
        data-date={date.toISOString()}
        data-testid={floating ? "floating-date-separator" : "date-separator"}
      >
        <div className="str-chat__slack-date-separator__line" aria-hidden />
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className="str-chat__slack-date-separator__pill"
            aria-label={`Jump to date: ${label}`}
          >
            <span className="str-chat__slack-date-separator__label">{label}</span>
            <ChevronDownIcon className="str-chat__slack-date-separator__chevron" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            side="bottom"
            sideOffset={6}
            className="str-chat__slack-date-separator__menu min-w-[220px]"
          >
            <DropdownMenuLabel className="text-muted-foreground font-normal">
              Jump to…
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void jumpToday()}>Today</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jumpYesterday()}>Yesterday</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jumpLastWeek()}>Last week</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jumpLastMonth()}>Last month</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void jumpBeginning()}>The very beginning</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                openPickDate();
              }}
            >
              Jump to a specific date…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>Jump to a specific date</DialogTitle>
            <DialogDescription>
              Opens around the first message from that day in the loaded history. Older days may
              require scrolling up to load more first.
            </DialogDescription>
          </DialogHeader>
          <input
            type="date"
            className="border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-2"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
          />
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDateDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmPickDate()}>
              Jump
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
