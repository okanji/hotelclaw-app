"use client";

import { createContext, useContext } from "react";
import { useUser } from "@liveblocks/react/suspense";
import type { Editor } from "@tiptap/react";
import type { ThreadData } from "@liveblocks/client";
import { Thread } from "@liveblocks/react-ui";
import type { ThreadProps } from "@liveblocks/react-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverHeader } from "./document-composer";

/**
 * Editor context so the AnchoredThreads' custom `Thread` component can reach
 * the same editor instance that owns the thread marks. AnchoredThreads passes
 * only `{ thread }` to its Thread renderer, so we plumb the editor in via
 * React context rather than rebuilding the component on every parent render.
 */
export const ThreadIndicatorEditorContext = createContext<Editor | null>(null);

/**
 * Gutter bubble that marks a comment thread next to the document body, in
 * the style of Notion / Liveblocks's own marketing example. Renders the
 * first commenter's avatar inside a speech-bubble shape. Click selects the
 * thread mark, which opens the inline `FloatingThreads` popover so the user
 * can reply or resolve.
 *
 * Used as `<AnchoredThreads components={{ Thread: DocumentThreadIndicator }} />`.
 */
export function DocumentThreadIndicator({ thread }: { thread: ThreadData }) {
  const editor = useContext(ThreadIndicatorEditorContext);

  // First non-deleted comment defines the "owner" face shown on the bubble.
  // Liveblocks's ThreadData carries comments even after deletion (with a
  // `deletedAt` flag), so skip those when picking the avatar.
  const firstUserId =
    thread.comments.find((c) => !c.deletedAt)?.userId ?? "";
  const { user } = useUser(firstUserId);

  const replyCount = thread.comments.filter((c) => !c.deletedAt).length - 1;
  const name = user?.name ?? "Someone";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <button
      type="button"
      onClick={() => editor?.commands.selectThread(thread.id)}
      aria-label={`Open comment thread by ${name}`}
      className={cn(
        "group relative inline-flex items-center justify-center",
        // Speech-bubble shape: circular avatar with a tail clipped via a
        // pseudo-element underneath.
        "size-9 rounded-full rounded-bl-sm",
        "border border-border bg-card shadow-sm transition-all",
        "hover:scale-105 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {firstUserId ? (
        <Avatar className="size-7">
          <AvatarImage src={user?.avatar ?? undefined} alt={name} />
          <AvatarFallback className="text-[10px]">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
      ) : (
        <MessageSquare className="size-4 text-muted-foreground" />
      )}
      {replyCount > 0 ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
        >
          {replyCount > 9 ? "9+" : replyCount + 1}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Wraps Liveblocks's default `Thread` (comment list + reply composer) with an
 * X close button. Used as `<FloatingThreads components={{ Thread: DocumentFloatingThread }} />`.
 *
 * `editor.commands.selectThread(null)` clears the active thread id list in
 * the CommentsExtension — which is what FloatingThreads uses to decide
 * whether to render the popover at all (see `selectThread` in
 * CommentsExtension.js).
 */
export function DocumentFloatingThread(props: ThreadProps) {
  const editor = useContext(ThreadIndicatorEditorContext);
  const onClose = editor ? () => editor.commands.selectThread(null) : null;

  return (
    <div className="flex flex-col">
      <PopoverHeader onClose={onClose} />
      <Thread {...props} />
    </div>
  );
}
