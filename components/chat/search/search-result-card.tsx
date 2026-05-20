"use client";

import type { MessageResponse } from "stream-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Hash, Lock, MessageSquare, Paperclip } from "lucide-react";
import { useTimeFormat } from "@/lib/preferences/time-format-context";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { highlight } from "./highlight";

type Props = {
  propertyId: string;
  message: MessageResponse;
  channelId: string | undefined;
  query: string;
};

function initialsOf(s: string): string {
  return (
    s
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function SearchResultCard({ propertyId, message, channelId, query }: Props) {
  const openChannel = useOpenChannel(propertyId);
  const { format: timeFormat } = useTimeFormat();

  const senderName = message.user?.name ?? message.user?.id ?? "Someone";
  const initials = initialsOf(senderName);

  const channelMeta = (message as { channel?: { name?: string; id?: string; type?: string; member_count?: number } }).channel;
  const isDm = channelMeta?.type === "messaging";
  const channelLabel =
    channelMeta?.name ?? channelMeta?.id ?? channelId ?? "channel";
  const ChannelIcon = isDm ? MessageSquare : Hash;

  const when = message.created_at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: timeFormat === "12h",
      }).format(new Date(message.created_at))
    : "";

  const text = message.text ?? "";
  const attachmentCount = message.attachments?.length ?? 0;

  function jump() {
    if (!channelId) return;
    openChannel(channelMeta?.type, channelId, { messageId: message.id });
  }

  return (
    <li>
      <button
        type="button"
        onClick={jump}
        className="group flex w-full gap-3 rounded-md border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted/40"
      >
        <Avatar className="size-9 shrink-0">
          <AvatarImage src={message.user?.image as string | undefined} />
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate font-semibold text-foreground">
              {senderName}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5">
              {isDm ? <ChannelIcon className="size-3" /> : channelMeta && (channelMeta as { is_private?: boolean }).is_private ? <Lock className="size-3" /> : <Hash className="size-3" />}
              <span className="truncate">{channelLabel}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{when}</span>
          </div>
          {text ? (
            <p className="mt-1 line-clamp-3 break-words text-sm text-foreground">
              {highlight(text, query)}
            </p>
          ) : null}
          {attachmentCount > 0 ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="size-3" />
              {attachmentCount} {attachmentCount === 1 ? "attachment" : "attachments"}
            </p>
          ) : null}
        </div>
        <span
          aria-hidden
          className="inline-flex h-8 shrink-0 items-center self-center rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          Jump →
        </span>
      </button>
    </li>
  );
}
