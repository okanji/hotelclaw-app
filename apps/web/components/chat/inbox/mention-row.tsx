"use client";

import type { MessageResponse } from "stream-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Hash } from "lucide-react";
import { useOpenChannel } from "@/lib/chat/use-open-channel";

type Props = {
  propertyId: string;
  message: MessageResponse;
};

export function MentionRow({ propertyId, message }: Props) {
  const openChannel = useOpenChannel(propertyId);
  const senderName = message.user?.name ?? message.user?.id ?? "Someone";
  const initials = senderName
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const channelId = message.cid?.split(":")[1];
  const channelName =
    (message as { channel?: { name?: string; id?: string } }).channel?.name ??
    channelId ??
    "channel";
  const when = message.created_at
    ? new Date(message.created_at).toLocaleString()
    : "";
  const text =
    message.text ?? (message.attachments?.length ? "(attachment)" : "");

  function open() {
    if (!channelId) return;
    // Navigate to the channel; the mentioned message will be in the message
    // list. Future: deep-link to highlight the specific message via query
    // param + Stream's `customActiveChannel` jumpToMessage.
    // `cid` is `<type>:<id>` — the type routes a DM mention to /dms, a
    // channel mention to /chat.
    openChannel(message.cid?.split(":")[0], channelId);
  }

  return (
    <li>
      <button
        onClick={open}
        className="flex w-full gap-3 rounded-md bg-background p-3 text-left transition-colors hover:bg-accent"
      >
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={message.user?.image as string | undefined} />
          <AvatarFallback className="text-xs">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{senderName}</span>
            <span className="inline-flex items-center gap-0.5">
              <Hash className="size-3" />
              {channelName}
            </span>
            <span>·</span>
            <span>{when}</span>
          </div>
          <p className="mt-1 line-clamp-3 break-words text-sm">{text}</p>
        </div>
      </button>
    </li>
  );
}
