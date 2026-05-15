"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import type { Attachment } from "stream-chat";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import emojiData from "@emoji-mart/data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  Code2,
  FileText,
  Italic,
  Link2,
  List,
  ListOrdered,
  Megaphone,
  Mic,
  Plus,
  Send,
  Smile,
  SquareSlash,
  Strikethrough,
  TextQuote,
  Type,
  Underline,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  RichEditor,
  type MentionContext,
  type RichEditorHandle,
} from "./rich-editor";
import { useEffect } from "react";

const EmojiPicker = dynamic(
  () => import("@emoji-mart/react").then((m) => m.default),
  { ssr: false },
);

type UploadingFile = {
  id: string;
  name: string;
  progress: "uploading" | "done" | "error";
};

type QueuedAttachment = Attachment & { _id: string };

type MentionCandidate = {
  id: string;
  name: string | null;
  image?: unknown;
  /** True for synthetic broadcast targets (`@channel`). Renders with a
   *  megaphone icon in the picker and is excluded from `mentioned_users`
   *  on send (the render + notification paths handle broadcasts via text). */
  isBroadcast?: boolean;
  /** Optional helper text shown in the picker (broadcast entries only). */
  description?: string;
};

/**
 * Slack-style composer with a real WYSIWYG editor (rich-editor.tsx) under it.
 * Bold/italic/underline/strike show as actual styled text in the input, lists
 * render with bullets/numbers and auto-continue on Enter. On send the editor
 * serializes to markdown for `channel.sendMessage`.
 */
export function SlackComposer({ placeholder }: { placeholder?: string }) {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();
  const { resolvedTheme } = useTheme();
  const myId = client?.user?.id;

  const editorRef = useRef<RichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sending, setSending] = useState(false);
  const [showFormatting, setShowFormatting] = useState(true);
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<MentionContext | null>(null);
  // Force a render when editor content changes so the send button can update.
  const [, bumpRender] = useState(0);

  const channelName =
    (channel?.data as { name?: string } | undefined)?.name ??
    channel?.id ??
    "channel";
  const ph = placeholder ?? `Message #${channelName}`;

  // ── Send ──────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || sending) return;
    const text = editor.getMarkdown();
    if (!text && attachments.length === 0) return;
    setSending(true);
    try {
      await channel.sendMessage({
        text,
        attachments: attachments.map(({ _id, ...rest }) => rest),
        // Source of truth is the DOM — derived from `data-mention` chips
        // present at send time, so removing a chip in the composer (whole-
        // unit backspace) correctly drops the user from the outgoing list.
        mentioned_users: editor.getMentionedIds(),
      });
      editor.clear();
      setAttachments([]);
      setMention(null);
    } catch (e) {
      console.error("send failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [attachments, channel, sending]);

  // ── Member candidates for mention popover ────────────────────────────
  const memberCandidates = useMemo(() => {
    const members = Object.values(channel?.state?.members ?? {});
    return members
      .map((m) => m.user)
      .filter(
        (u): u is NonNullable<typeof u> & { id: string } =>
          !!u && !!u.id && u.id !== myId,
      )
      .slice(0, 50);
  }, [channel, myId]);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query;
    // Slack-style broadcast candidate. Notifies everyone in the channel
    // when the message lands. Rendered with a megaphone icon, NOT added to
    // `mentioned_users` on send — Stream would reject the unknown user id.
    // The render-side `slackRenderText` reconstructs the pill from the text.
    const broadcast: MentionCandidate = {
      id: "channel",
      name: "channel",
      description: "Notify everyone in this channel",
      isBroadcast: true,
    };
    const broadcastMatches = "channel".startsWith(q);
    const userMatches = q
      ? memberCandidates.filter((u) => {
          const name = (u.name ?? "").toLowerCase();
          return name.includes(q) || u.id.toLowerCase().includes(q);
        })
      : memberCandidates;
    return [
      ...(broadcastMatches ? [broadcast] : []),
      ...userMatches.map(
        (u): MentionCandidate => ({ id: u.id, name: u.name ?? null, image: u.image }),
      ),
    ].slice(0, 8);
  }, [mention, memberCandidates]);

  const mentionOpen = !!mention && mentionMatches.length > 0;

  function applyMention(candidate: MentionCandidate) {
    const editor = editorRef.current;
    if (!editor || !mention) return;
    const display = (candidate.name ?? candidate.id).replace(/\s+/g, "");
    editor.replaceRangeWithMention(mention.range, {
      id: candidate.id,
      display,
      isBroadcast: !!candidate.isBroadcast,
    });
    setMention(null);
  }

  // ── File uploads ─────────────────────────────────────────────────────
  function pickFiles() {
    fileInputRef.current?.click();
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((u) => [...u, { id, name: file.name, progress: "uploading" }]);
      try {
        const isImage = file.type.startsWith("image/");
        const res = isImage
          ? await channel.sendImage(file, file.name, file.type)
          : await channel.sendFile(file, file.name, file.type);
        const url = (res as { file: string }).file;
        const attachment: QueuedAttachment = isImage
          ? {
              _id: id,
              type: "image",
              image_url: url,
              thumb_url: url,
              fallback: file.name,
              mime_type: file.type,
              file_size: file.size,
            }
          : {
              _id: id,
              type: "file",
              asset_url: url,
              title: file.name,
              mime_type: file.type,
              file_size: file.size,
            };
        setAttachments((a) => [...a, attachment]);
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (err) {
        console.error("upload failed", err);
        toast.error(`Upload failed: ${file.name}`);
        setUploads((u) =>
          u.map((x) => (x.id === id ? { ...x, progress: "error" } : x)),
        );
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((a) => a.filter((x) => x._id !== id));
  }

  // ── Render ────────────────────────────────────────────────────────────
  const isEditorEmpty = editorRef.current?.isEmpty() ?? true;
  const canSend = (!isEditorEmpty || attachments.length > 0) && !sending;

  return (
    <div className="group/composer mx-4 mb-4 mt-2 flex flex-col rounded-lg border border-black/10 bg-transparent transition-colors focus-within:border-black/20 dark:border-[oklch(1_0_0_/_0.13)] dark:focus-within:border-[oklch(1_0_0_/_0.22)]">
      {/* Attachment preview chips */}
      {(attachments.length > 0 || uploads.length > 0) && (
        <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          {attachments.map((a) => (
            <AttachmentChip
              key={a._id}
              attachment={a}
              onRemove={() => removeAttachment(a._id)}
            />
          ))}
          {uploads.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground"
            >
              <span className="size-3 animate-pulse rounded-sm bg-muted-foreground/40" />
              <span className="max-w-[140px] truncate">{u.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Formatting toolbar */}
      {showFormatting && (
        <div className="flex items-center gap-0 px-2 pt-1.5">
          <ToolbarGroup>
            <IconBtn
              label="Bold (Ctrl+B)"
              onClick={() => editorRef.current?.format("bold")}
            >
              <Bold />
            </IconBtn>
            <IconBtn
              label="Italic (Ctrl+I)"
              onClick={() => editorRef.current?.format("italic")}
            >
              <Italic />
            </IconBtn>
            <IconBtn
              label="Underline"
              onClick={() => editorRef.current?.format("underline")}
            >
              <Underline />
            </IconBtn>
            <IconBtn
              label="Strikethrough"
              onClick={() => editorRef.current?.format("strikeThrough")}
            >
              <Strikethrough />
            </IconBtn>
          </ToolbarGroup>
          <Divider />
          <ToolbarGroup>
            <IconBtn
              label="Link"
              onClick={() => {
                const url = window.prompt("URL", "https://");
                if (!url) return;
                editorRef.current?.insertLink(url);
              }}
            >
              <Link2 />
            </IconBtn>
            <IconBtn
              label="Numbered list"
              onClick={() => editorRef.current?.format("insertOrderedList")}
            >
              <ListOrdered />
            </IconBtn>
            <IconBtn
              label="Bulleted list"
              onClick={() => editorRef.current?.format("insertUnorderedList")}
            >
              <List />
            </IconBtn>
          </ToolbarGroup>
          <Divider />
          <ToolbarGroup>
            <IconBtn
              label="Quote"
              onClick={() =>
                editorRef.current?.format("formatBlock", "blockquote")
              }
            >
              <TextQuote />
            </IconBtn>
            <IconBtn
              label="Inline code"
              onClick={() => editorRef.current?.inlineCode()}
            >
              <Code />
            </IconBtn>
            <IconBtn
              label="Code block"
              onClick={() => editorRef.current?.codeBlock()}
            >
              <Code2 />
            </IconBtn>
          </ToolbarGroup>
        </div>
      )}

      {/* Editor (mention popover anchored on the wrapper) */}
      <div className="px-[17px] py-[13px]">
        <Popover
          open={mentionOpen}
          onOpenChange={(o) => {
            if (!o) setMention(null);
          }}
        >
          <PopoverTrigger
            nativeButton={false}
            render={
              <div tabIndex={-1} className="outline-none focus:outline-none">
                <RichEditor
                  ref={editorRef}
                  placeholder={ph}
                  onSubmit={submit}
                  onChange={() => bumpRender((n) => n + 1)}
                  onMentionContextChange={setMention}
                  shouldYieldKey={(e) => {
                    if (!mentionOpen) return false;
                    return (
                      e.key === "ArrowDown" ||
                      e.key === "ArrowUp" ||
                      e.key === "Enter" ||
                      e.key === "Tab" ||
                      e.key === "Escape"
                    );
                  }}
                />
              </div>
            }
          />
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-72 p-1"
          >
            <MentionList
              items={mentionMatches}
              onSelect={applyMention}
              onCancel={() => setMention(null)}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Bottom action row */}
      <div className="flex items-center justify-between px-2 pb-1.5">
        <div className="flex items-center gap-0">
          <ToolbarGroup>
            <IconBtn label="Attach files" onClick={pickFiles}>
              <Plus />
            </IconBtn>
            <IconBtn
              label="Formatting"
              active={showFormatting}
              onClick={() => setShowFormatting((v) => !v)}
            >
              <Type />
            </IconBtn>
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label="Emoji"
                    title="Emoji"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors group-focus-within/composer:text-foreground/65 hover:bg-black/5 hover:text-foreground dark:group-focus-within/composer:text-[#AAAAAB] dark:hover:bg-[oklch(1_0_0_/_0.08)] [&_svg]:size-[18px]"
                  >
                    <Smile />
                  </button>
                }
              />
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                className="border-0 bg-transparent p-0 shadow-none"
              >
                <EmojiPicker
                  data={emojiData}
                  theme={resolvedTheme === "light" ? "light" : "dark"}
                  previewPosition="none"
                  skinTonePosition="none"
                  navPosition="bottom"
                  onEmojiSelect={(emoji: { native?: string }) => {
                    if (emoji?.native)
                      editorRef.current?.insertText(emoji.native);
                    setEmojiOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <IconBtn
              label="Mention someone"
              onClick={() => editorRef.current?.insertText("@")}
            >
              <AtSign />
            </IconBtn>
          </ToolbarGroup>
          <Divider />
          <ToolbarGroup>
            <IconBtn label="Voice message — not yet available">
              <Mic />
            </IconBtn>
          </ToolbarGroup>
          <Divider />
          <ToolbarGroup>
            <IconBtn
              label="Slash command"
              onClick={() => editorRef.current?.insertText("/")}
            >
              <SquareSlash />
            </IconBtn>
          </ToolbarGroup>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Send message"
            onClick={() => void submit()}
            disabled={!canSend}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md transition-colors",
              canSend
                ? "text-foreground hover:bg-black/5 dark:hover:bg-[oklch(1_0_0_/_0.08)]"
                : "text-muted-foreground/60 group-focus-within/composer:text-foreground/65 dark:group-focus-within/composer:text-[#AAAAAB]",
            )}
          >
            <Send className="size-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Send options"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors group-focus-within/composer:text-foreground/65 hover:bg-black/5 hover:text-foreground dark:group-focus-within/composer:text-[#AAAAAB] dark:hover:bg-[oklch(1_0_0_/_0.08)]"
          >
            <ChevronDown className="size-[18px]" />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFiles}
      />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0">{children}</div>;
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-4 w-px shrink-0 bg-black/10 dark:bg-[oklch(1_0_0_/_0.12)]"
    />
  );
}

function IconBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        // Keep the editor focused so execCommand has a valid selection.
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors [&_svg]:size-[18px]",
        active
          ? "bg-black/10 text-foreground dark:bg-[oklch(1_0_0_/_0.1)]"
          : "text-muted-foreground hover:bg-black/5 hover:text-foreground group-focus-within/composer:text-foreground/65 dark:group-focus-within/composer:text-[#AAAAAB] dark:hover:bg-[oklch(1_0_0_/_0.08)]",
      )}
    >
      {children}
    </button>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: QueuedAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.type === "image";
  const title =
    (attachment.fallback as string | undefined) ??
    (attachment.title as string | undefined) ??
    "attachment";
  return (
    <div className="group relative inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[12px]">
      {isImage && attachment.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.thumb_url ?? attachment.image_url}
          alt=""
          className="size-6 rounded object-cover"
        />
      ) : (
        <FileText className="size-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[140px] truncate">{title}</span>
      <button
        type="button"
        aria-label="Remove attachment"
        onClick={onRemove}
        className="ml-1 inline-flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-[oklch(1_0_0_/_0.08)]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function MentionList({
  items,
  onSelect,
  onCancel,
}: {
  items: Array<MentionCandidate>;
  onSelect: (u: MentionCandidate) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const u = items[index];
        if (u) onSelect(u);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items, index, onSelect, onCancel]);

  if (items.length === 0) return null;
  return (
    <ul role="listbox" className="flex max-h-64 flex-col overflow-y-auto">
      {items.map((u, i) => {
        const initials = (u.name ?? u.id ?? "?")
          .split(/\s+/)
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <li key={u.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onSelect(u)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                i === index
                  ? "bg-black/5 text-foreground dark:bg-[oklch(1_0_0_/_0.08)]"
                  : "text-foreground/90",
              )}
            >
              {u.isBroadcast ? (
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--slack-mention-broadcast-bg)] text-[var(--slack-mention-broadcast-text)]">
                  <Megaphone className="size-3.5" />
                </span>
              ) : (
                <Avatar className="size-6">
                  <AvatarImage
                    src={typeof u.image === "string" ? u.image : undefined}
                    alt=""
                  />
                  <AvatarFallback className="text-[10px]">
                    {initials || "?"}
                  </AvatarFallback>
                </Avatar>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  @{u.name ?? u.id}
                </span>
                {u.description ? (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {u.description}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
