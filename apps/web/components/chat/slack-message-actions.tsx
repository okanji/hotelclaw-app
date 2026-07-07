"use client";

import { useState } from "react";
import clsx from "clsx";
import dynamic from "next/dynamic";
import emojiData from "@emoji-mart/data";
import { useTheme } from "next-themes";
import {
  useChannelStateContext,
  useChatContext,
  useMessageContext,
  useMessageReminder,
} from "stream-chat-react";
import { channelHref } from "@/lib/chat/channel-href";
import {
  Bookmark,
  Link as LinkIcon,
  MailOpen,
  MessageSquareReply,
  MoreVertical,
  Pin,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EmojiPicker = dynamic(
  () => import("@emoji-mart/react").then((m) => m.default),
  { ssr: false },
);

/** Inline quick-react set — clicking one of these emojis toggles a reaction
 *  directly without opening a picker, matching Slack's "frequents" row.
 *  Reaction `type` is the emoji-mart id (ASCII) — Stream's backend reliably
 *  persists ASCII reaction types, where native unicode glyphs don't survive
 *  a `channel.watch()` refresh. SlackMessageReactions looks up the native
 *  glyph at render time via `getEmojiNative()`. */
const QUICK_REACTIONS: Array<{ id: string; native: string; label: string }> = [
  { id: "white_check_mark", native: "✅", label: "check mark" },
  { id: "raised_hands", native: "🙌", label: "raised hands" },
  { id: "fire", native: "🔥", label: "fire" },
];

/**
 * Custom Slack-style hover toolbar that replaces Stream's default
 * <MessageActions>. Layout (left → right):
 *   quick reactions · add reaction · reply in thread · save · copy link · ⋮
 *
 * Mounted inside `.str-chat__slack-message-actions-host`. Reuses the
 * `.str-chat__message-options` class so the existing show-on-hover CSS in
 * `app/stream-chat-overrides.css` keeps working without changes. When any
 * child popover/dropdown is open, we add `.str-chat__message-options--active`
 * (also a Stream-CSS-recognized modifier) so the pill stays visible while
 * the mouse moves to the floating panel — otherwise the row :hover ends, the
 * pill unmounts the anchor, and the popover jumps/closes.
 */
export function SlackMessageActions() {
  const { channel } = useChannelStateContext();
  const {
    message,
    handleReaction,
    handleOpenThread,
    handlePin,
    handleDelete,
    handleMarkUnread,
    isMyMessage,
    threadList,
  } = useMessageContext("SlackMessageActions");
  const reminder = useMessageReminder(message.id);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const anyOpen = emojiOpen || overflowOpen;

  return (
    <div
      className={clsx("str-chat__message-options", {
        "str-chat__message-options--active": anyOpen,
      })}
      data-slack-pill="true"
    >
      {QUICK_REACTIONS.map((r) => (
        <QuickReactionButton
          key={r.id}
          native={r.native}
          label={r.label}
          onClick={(e) => void handleReaction(r.id, e)}
        />
      ))}

      <AddReactionButton
        open={emojiOpen}
        onOpenChange={setEmojiOpen}
        onSelect={(reactionType, event) => void handleReaction(reactionType, event)}
      />

      {!threadList ? (
        <ToolbarButton
          label="Reply in thread"
          onClick={handleOpenThread}
        >
          <MessageSquareReply />
        </ToolbarButton>
      ) : null}

      <SaveButton
        messageId={message.id}
        isSaved={!!reminder}
      />

      <CopyLinkButton
        propertyId={getPropertyIdFromChannel(channel)}
        channelId={channel.id ?? ""}
        channelType={channel.type}
        messageId={message.id}
      />

      <OverflowMenu
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        isPinned={!!message.pinned}
        isMine={isMyMessage()}
        onPin={handlePin}
        onDelete={() => void handleDelete()}
        onMarkUnread={handleMarkUnread}
      />
    </div>
  );
}

function QuickReactionButton({
  native,
  label,
  onClick,
}: {
  native: string;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`React with ${label}`}
      title={`React with ${label}`}
      className="inline-flex size-7 items-center justify-center rounded-md text-base leading-none transition hover:bg-foreground/10"
    >
      <span className="leading-none">{native}</span>
    </button>
  );
}

function ToolbarButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-active={active ? "true" : undefined}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground data-[active=true]:bg-foreground/10 data-[active=true]:text-foreground [&_svg]:size-[16px]"
    >
      {children}
    </button>
  );
}

function AddReactionButton({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (reactionType: string, event: React.SyntheticEvent) => void;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Add reaction"
            title="Add reaction"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground [&_svg]:size-[16px]"
          />
        }
      >
        <SmilePlus />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="border-0 bg-transparent p-0 shadow-none"
      >
        <EmojiPicker
          data={emojiData}
          theme={resolvedTheme === "light" ? "light" : "dark"}
          previewPosition="none"
          skinTonePosition="none"
          navPosition="bottom"
          onEmojiSelect={(emoji: { id?: string; native?: string }, event: React.SyntheticEvent) => {
            // Send the emoji-mart id (ASCII) as the reaction type — Stream
            // persists ASCII types reliably. Render time converts back to the
            // native glyph via `getEmojiNative()`. Falls back to native only
            // if id is missing (shouldn't happen with emoji-mart).
            const type = emoji?.id ?? emoji?.native;
            if (type) onSelect(type, event);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function SaveButton({
  messageId,
  isSaved,
}: {
  messageId: string;
  isSaved: boolean;
}) {
  const { client } = useChatContext();
  async function toggle() {
    try {
      if (isSaved) {
        await client.deleteReminder(messageId);
        toast.success("Removed from saved");
      } else {
        await client.createReminder({ messageId });
        toast.success("Saved for later");
      }
    } catch (e) {
      console.error("toggle save failed", e);
      toast.error("Couldn't update saved");
    }
  }
  return (
    <ToolbarButton
      label={isSaved ? "Remove from saved" : "Save for later"}
      active={isSaved}
      onClick={() => void toggle()}
    >
      <Bookmark className={isSaved ? "fill-current" : undefined} />
    </ToolbarButton>
  );
}

function CopyLinkButton({
  propertyId,
  channelId,
  channelType,
  messageId,
}: {
  propertyId: string | null;
  channelId: string;
  channelType: string;
  messageId: string;
}) {
  if (!propertyId || !channelId) return null;
  async function copy() {
    try {
      // `propertyId`/`channelId` are non-null past the guard above; TS
      // doesn't carry that narrowing into this nested closure.
      const url = `${window.location.origin}${channelHref(
        propertyId!,
        channelType,
        channelId,
        { messageId },
      )}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch (e) {
      console.error("copy link failed", e);
      toast.error("Couldn't copy link");
    }
  }
  return (
    <ToolbarButton label="Copy link to message" onClick={() => void copy()}>
      <LinkIcon />
    </ToolbarButton>
  );
}

function OverflowMenu({
  open,
  onOpenChange,
  isPinned,
  isMine,
  onPin,
  onDelete,
  onMarkUnread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPinned: boolean;
  isMine: boolean;
  onPin: (event: React.SyntheticEvent) => void;
  onDelete: () => void;
  onMarkUnread: (event: React.SyntheticEvent) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="More actions"
            title="More actions"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground [&_svg]:size-[16px]"
          />
        }
      >
        <MoreVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
        <DropdownMenuItem onClick={(e) => onPin(e)}>
          <Pin className="size-4" />
          {isPinned ? "Unpin from channel" : "Pin to channel"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => onMarkUnread(e)}>
          <MailOpen className="size-4" />
          Mark unread
        </DropdownMenuItem>
        {isMine ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete message
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getPropertyIdFromChannel(
  channel: ReturnType<typeof useChannelStateContext>["channel"],
): string | null {
  const data = channel.data as { property_id?: string } | undefined;
  return data?.property_id ?? null;
}
