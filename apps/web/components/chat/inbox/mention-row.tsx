"use client";

import type { MessageResponse } from "stream-chat";
import { Hash, MessageSquare } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { relativeTimeShort } from "@/lib/relative-time";

type Props = {
  propertyId: string;
  message: MessageResponse;
};

/** One mention — a gr8r `.nrow`: sender `Av`, the message, channel · time. */
export function MentionRow({ propertyId, message }: Props) {
  const openChannel = useOpenChannel(propertyId);
  const senderName = message.user?.name ?? message.user?.id ?? "Someone";
  const [channelType, channelId] = (message.cid ?? "").split(":");
  const channelName =
    (message as { channel?: { name?: string; id?: string } }).channel?.name ??
    channelId ??
    "channel";
  const text =
    message.text ?? (message.attachments?.length ? "(attachment)" : "");

  function open() {
    if (!channelId) return;
    // `cid` is `<type>:<id>` — the type routes a DM mention to /dms, a
    // channel mention to /chat.
    openChannel(channelType, channelId);
  }

  return (
    <div
      className="nrow"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <Av
        member={{
          id: message.user?.id ?? senderName,
          name: senderName,
          avatarUrl: (message.user?.image as string | undefined) ?? null,
        }}
        size="md"
      />
      <div className="grow" style={{ fontSize: 13 }}>
        <div>
          <b style={{ fontWeight: 600 }}>{senderName}</b>{" "}
          <span className="muted">mentioned you</span>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 12.5,
            marginTop: 2,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {text}
        </div>
        <div
          className="faint row"
          style={{ fontSize: 11.5, marginTop: 4, gap: 4 }}
        >
          <Gi icon={channelType === "messaging" ? MessageSquare : Hash} size={11} />
          <span className="trunc">{channelName}</span>
          {message.created_at ? (
            <span title={new Date(message.created_at).toLocaleString()}>
              · {relativeTimeShort(message.created_at)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
