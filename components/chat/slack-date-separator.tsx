"use client";

import clsx from "clsx";
import { ChevronDownIcon } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Channel, LocalMessage, MessageFilters, StreamChat } from "stream-chat";
import {
  isDateSeparatorMessage,
  isIntroMessage,
  useChannelActionContext,
  useChannelStateContext,
  useChatContext,
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
  DropdownMenuGroup,
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

/** Matches Stream React `jumpToFirstUnread` / message pagination — load a window around a timestamp. */
const MESSAGES_AROUND_LIMIT = 50;

async function queryMessagesAroundDay(channel: Channel, day: Date): Promise<LocalMessage[]> {
  const anchor = new Date(day);
  anchor.setHours(12, 0, 0, 0);
  const { messages: page } = await channel.query(
    {
      messages: {
        created_at_around: anchor.toISOString(),
        limit: MESSAGES_AROUND_LIMIT,
      },
    },
    "new",
  );
  return page as unknown as LocalMessage[];
}

async function queryMessagesAroundTimestamp(channel: Channel, at: Date): Promise<LocalMessage[]> {
  const anchor = new Date(at);
  anchor.setHours(12, 0, 0, 0);
  const { messages: page } = await channel.query(
    {
      messages: {
        created_at_around: anchor.toISOString(),
        limit: MESSAGES_AROUND_LIMIT,
      },
    },
    "new",
  );
  return page as unknown as LocalMessage[];
}

/** First matching message in the channel, ascending by `created_at` (requires Stream message search). */
async function searchFirstMessageMatching(
  client: StreamChat,
  channelCid: string,
  messageFilter: MessageFilters,
): Promise<string | undefined> {
  const { results } = await client.search(
    { cid: { $eq: channelCid } },
    messageFilter,
    { limit: 1, sort: { created_at: 1 } },
  );
  return results[0]?.message?.id;
}

async function resolveFirstMessageIdForDay(
  channel: Channel,
  client: StreamChat,
  cachedMessages: LocalMessage[] | undefined,
  day: Date,
): Promise<string | undefined> {
  const cached = firstMessageIdAtStartOfDay(cachedMessages, day);
  if (cached) return cached;

  try {
    const page = await queryMessagesAroundDay(channel, day);
    const fromQuery = firstMessageIdAtStartOfDay(page, day);
    if (fromQuery) return fromQuery;
  } catch (e) {
    console.warn("SlackDateSeparator: channel.query around date failed", e);
  }

  return searchFirstMessageMatching(client, channel.cid, {
    $and: [
      { created_at: { $gte: startOfDay(day).toISOString() } },
      { created_at: { $lt: new Date(startOfDay(day).getTime() + 86400000).toISOString() } },
    ],
  });
}

async function resolveFirstMessageOnOrAfter(
  channel: Channel,
  client: StreamChat,
  cachedMessages: LocalMessage[] | undefined,
  boundary: Date,
): Promise<string | undefined> {
  let id = firstMessageIdOnOrAfter(cachedMessages, boundary);
  if (id) return id;

  try {
    const page = await queryMessagesAroundTimestamp(channel, boundary);
    id = firstMessageIdOnOrAfter(page, boundary);
    if (id) return id;
  } catch (e) {
    console.warn("SlackDateSeparator: channel.query around boundary failed", e);
  }

  return searchFirstMessageMatching(client, channel.cid, {
    created_at: { $gte: boundary.toISOString() },
  });
}

async function resolveFirstMessageInCalendarRange(
  channel: Channel,
  client: StreamChat,
  cachedMessages: LocalMessage[] | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<string | undefined> {
  if (cachedMessages?.length) {
    for (const m of cachedMessages) {
      if (!isRenderableChatMessage(m)) continue;
      const c = m.created_at ? new Date(m.created_at) : null;
      if (!c || Number.isNaN(c.getTime())) continue;
      if (c >= rangeStart && c <= rangeEnd) return m.id;
    }
  }

  return searchFirstMessageMatching(client, channel.cid, {
    $and: [
      { created_at: { $gte: rangeStart.toISOString() } },
      { created_at: { $lte: rangeEnd.toISOString() } },
    ],
  });
}

async function resolveOldestMessageId(
  channel: Channel,
  client: StreamChat,
  cachedMessages: LocalMessage[] | undefined,
  channelHasOlderPages: boolean | undefined,
): Promise<string | undefined> {
  if (channelHasOlderPages === false) {
    const id = firstRealMessageId(cachedMessages);
    if (id) return id;
  }

  return searchFirstMessageMatching(client, channel.cid, {
    created_at: { $lte: new Date().toISOString() },
  });
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
  const { messages, channel, hasMore } = useChannelStateContext("SlackDateSeparator");
  const { client } = useChatContext();
  const { jumpToLatestMessage, jumpToMessage } = useChannelActionContext("SlackDateSeparator");

  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [pickDateJumpLoading, setPickDateJumpLoading] = useState(false);

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
    try {
      const day = subDays(startOfDay(new Date()), 1);
      const id = await resolveFirstMessageIdForDay(channel, client, messages, day);
      if (!id) {
        toast.error("No messages yesterday.");
        return;
      }
      await runJump(id);
    } catch (e) {
      console.warn("SlackDateSeparator: jumpYesterday", e);
      toast.error("Could not jump to yesterday. Message search may need to be enabled.");
    }
  }, [channel, client, messages, runJump]);

  const jumpLastWeek = useCallback(async () => {
    try {
      const boundary = startOfDay(subDays(new Date(), 7));
      const id = await resolveFirstMessageOnOrAfter(channel, client, messages, boundary);
      if (!id) {
        toast.error("No messages from that week onward.");
        return;
      }
      await runJump(id);
    } catch (e) {
      console.warn("SlackDateSeparator: jumpLastWeek", e);
      toast.error("Could not jump to last week. Message search may need to be enabled.");
    }
  }, [channel, client, messages, runJump]);

  const jumpLastMonth = useCallback(async () => {
    try {
      const now = new Date();
      const start = startOfPreviousMonth(now);
      const end = endOfPreviousMonth(now);
      const id = await resolveFirstMessageInCalendarRange(channel, client, messages, start, end);
      if (!id) {
        toast.error("No messages in the previous calendar month.");
        return;
      }
      await runJump(id);
    } catch (e) {
      console.warn("SlackDateSeparator: jumpLastMonth", e);
      toast.error("Could not jump to last month. Message search may need to be enabled.");
    }
  }, [channel, client, messages, runJump]);

  const jumpBeginning = useCallback(async () => {
    try {
      const id = await resolveOldestMessageId(channel, client, messages, hasMore);
      if (!id) {
        toast.error("No messages in this channel.");
        return;
      }
      await runJump(id);
    } catch (e) {
      console.warn("SlackDateSeparator: jumpBeginning", e);
      toast.error("Could not jump to the beginning. Message search may need to be enabled.");
    }
  }, [channel, client, hasMore, messages, runJump]);

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
    setPickDateJumpLoading(true);
    try {
      const id = await resolveFirstMessageIdForDay(channel, client, messages, targetDay);
      if (!id) {
        toast.error("No messages on that date.");
        return;
      }
      setDateDialogOpen(false);
      await runJump(id);
    } catch (e) {
      console.warn("SlackDateSeparator: confirmPickDate", e);
      toast.error("Could not load that date. Message search may need to be enabled.");
    } finally {
      setPickDateJumpLoading(false);
    }
  }, [channel, client, messages, pickedDate, runJump]);

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
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                Jump to…
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void jumpToday()}>Today</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void jumpYesterday()}>Yesterday</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void jumpLastWeek()}>Last week</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void jumpLastMonth()}>Last month</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void jumpBeginning()}>The very beginning</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  openPickDate();
                }}
              >
                Jump to a specific date…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>Jump to a specific date</DialogTitle>
            <DialogDescription>
              Jumps to the first message on that calendar day. The channel loads a window around that
              time; if nothing is in memory yet, message search is used when available.
            </DialogDescription>
          </DialogHeader>
          <input
            type="date"
            className="border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-2"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
            disabled={pickDateJumpLoading}
          />
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pickDateJumpLoading || !pickedDate}
              onClick={() => void confirmPickDate()}
            >
              {pickDateJumpLoading ? "Jumping…" : "Jump"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
