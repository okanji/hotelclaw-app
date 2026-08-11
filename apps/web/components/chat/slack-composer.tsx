"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useChannelStateContext,
  useChatContext,
  useThreadContext,
} from "stream-chat-react";
import type { Attachment } from "stream-chat";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import emojiData from "@emoji-mart/data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AtSign,
  Bold,
  ChevronDown,
  CircleAlert,
  CircleStop,
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
  Trash2,
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
import { formatAudioDuration, useVoiceRecorder } from "./use-voice-recorder";
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

/** Stream's CDN rejects uploads over 100 MB (dashboard default). Guarding
 *  client-side turns a slow, doomed upload into an instant toast. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Map a file's mime type onto the Stream attachment `type` the renderers
 *  key off. Getting this right is what makes an uploaded .mp4 render as a
 *  playable video (not a download row) and lands it in the correct bucket
 *  of the channel Files tab (`use-channel-files.ts` queries by type). */
function attachmentKindFor(file: File): "image" | "video" | "audio" | "file" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

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
export function SlackComposer({
  placeholder,
  parentId: parentIdProp,
}: {
  placeholder?: string;
  /** Explicit thread parent id — overrides whatever's in context. Used by
   *  the threads feed where many thread cards share a channel and we can't
   *  rely on `channel.state.thread` (it's a per-channel singleton). */
  parentId?: string;
}) {
  // Where the parent message comes from depends on how this composer is
  // mounted: inline channel reply → `channel.state.thread` (set by
  // openThread); ChatView.ThreadAdapter path → ThreadContext; the threads
  // feed → explicit prop. Check all three.
  const { channel, thread: channelStateThread } = useChannelStateContext();
  const { client } = useChatContext();
  const threadInstance = useThreadContext();
  const { resolvedTheme } = useTheme();
  const myId = client?.user?.id;
  // Thread instance from the new API stores its parent on a StateStore; a
  // one-shot read is fine here — parent messages don't change between
  // mount and the next interaction.
  const contextParentId =
    channelStateThread?.id ??
    threadInstance?.state.getLatestValue().parentMessage.id;
  const parentId = parentIdProp ?? contextParentId;
  const isThreadReply = !!parentId;

  const editorRef = useRef<RichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [sending, setSending] = useState(false);
  const [showFormatting, setShowFormatting] = useState(true);
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Force a render when editor content changes so the send button can update.
  const [, bumpRender] = useState(0);

  // Slack-style voice messages. While recording/processing, the editor row is
  // visually replaced by the recording strip and send/attach are disabled —
  // stop first, the chip appears, then send (least-surprising: nothing can
  // race the encode, and text typed earlier is preserved underneath).
  const recorder = useVoiceRecorder();
  const recorderActive = recorder.status !== "idle";
  // Stable reference for the scope-reset effect (the `recorder` object is
  // rebuilt each render; its callbacks are not).
  const cancelRecording = recorder.cancel;

  // This component is NOT remounted on channel switch (`<Channel>` has no
  // key), so composer state would otherwise follow the user across channels —
  // stage a file in #a, switch to #b, send → the file lands in #b. Reset the
  // draft whenever the (channel, thread) scope changes, and tag in-flight
  // uploads with the scope they started in so a late-resolving upload can't
  // re-inject an attachment into the wrong channel's draft.
  const scopeKey = `${channel?.cid ?? "none"}:${parentId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    setAttachments([]);
    setUploads([]);
    setMention(null);
    editorRef.current?.clear();
    // An in-progress voice recording belongs to the channel it started in —
    // discard it rather than let it land in the new channel's draft.
    cancelRecording();
  }, [scopeKey, cancelRecording]);

  // Typing indicators. This is a fully custom composer — it calls
  // `channel.sendMessage` directly and never mounts Stream's `MessageInput` /
  // `MessageComposer`, which is the only thing that normally calls
  // `channel.keystroke()`. Without this, a web user NEVER appears as typing on
  // any client (mobile included), even though `typing_events` is enabled on
  // both channel types and `MessageList` renders the indicator fine.
  // `keystroke()` self-throttles to one `typing.start` per 2s, so calling it on
  // every change is safe.
  const notifyTyping = useCallback(() => {
    void channel?.keystroke(parentId ?? undefined).catch(() => {});
  }, [channel, parentId]);

  const stopTyping = useCallback(() => {
    void channel?.stopTyping(parentId ?? undefined).catch(() => {});
  }, [channel, parentId]);

  // Leaving the channel/thread mid-draft would otherwise strand a typing.start
  // until the server's own expiry.
  useEffect(() => stopTyping, [stopTyping]);

  const channelName =
    (channel?.data as { name?: string } | undefined)?.name ??
    channel?.id ??
    "channel";
  const ph =
    placeholder ?? (isThreadReply ? "Reply…" : `Message #${channelName}`);

  // ── Send ──────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || sending) return;
    // Don't let Enter race an in-flight upload — the message would send
    // without the attachment and orphan the upload chip.
    if (uploads.some((u) => u.progress === "uploading")) {
      toast.info("Hold on — files are still uploading");
      return;
    }
    // Same rule for a voice message mid-recording: stop it first so the
    // attachment can't be silently left behind.
    if (recorderActive) {
      toast.info("Finish your voice message first");
      return;
    }
    const text = editor.getMarkdown();
    if (!text && attachments.length === 0) return;
    setSending(true);
    // Clear the indicator immediately rather than waiting for server expiry.
    stopTyping();
    try {
      await channel.sendMessage({
        text,
        attachments: attachments.map(({ _id, ...rest }) => rest),
        // Source of truth is the DOM — derived from `data-mention` chips
        // present at send time, so removing a chip in the composer (whole-
        // unit backspace) correctly drops the user from the outgoing list.
        mentioned_users: editor.getMentionedIds(),
        // In a thread panel: attach to the parent and keep it out of the
        // channel feed. Both fields are ignored by Stream when `parent_id`
        // is undefined, so the main composer sends normally.
        ...(parentId
          ? { parent_id: parentId, show_in_channel: false }
          : {}),
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
  }, [attachments, channel, parentId, recorderActive, sending, stopTyping, uploads]);

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

  // Shared upload path for the attach button, paste, and drag-and-drop.
  // Files upload concurrently; each is tagged with the scope it started in
  // so a completion after a channel switch is discarded, not misfiled.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || !channel) return;
      const scope = scopeKey;
      await Promise.all(
        files.map(async (file) => {
          if (file.size > MAX_UPLOAD_BYTES) {
            toast.error(`"${file.name}" is over the 100 MB upload limit`);
            return;
          }
          const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          setUploads((u) => [...u, { id, name: file.name, progress: "uploading" }]);
          try {
            const kind = attachmentKindFor(file);
            const res =
              kind === "image"
                ? await channel.sendImage(file, file.name, file.type)
                : await channel.sendFile(file, file.name, file.type);
            const url = (res as { file: string }).file;
            const attachment: QueuedAttachment =
              kind === "image"
                ? {
                    _id: id,
                    type: "image",
                    image_url: url,
                    thumb_url: url,
                    fallback: file.name,
                    title: file.name,
                    mime_type: file.type,
                    file_size: file.size,
                  }
                : {
                    _id: id,
                    type: kind,
                    asset_url: url,
                    title: file.name,
                    mime_type: file.type,
                    file_size: file.size,
                  };
            if (scopeRef.current !== scope) return;
            setAttachments((a) => [...a, attachment]);
            setUploads((u) => u.filter((x) => x.id !== id));
          } catch (err) {
            console.error("upload failed", err);
            toast.error(`Upload failed: ${file.name}`);
            if (scopeRef.current !== scope) return;
            setUploads((u) =>
              u.map((x) => (x.id === id ? { ...x, progress: "error" } : x)),
            );
          }
        }),
      );
    },
    [channel, scopeKey],
  );

  // ── Voice message ────────────────────────────────────────────────────
  const startVoiceRecording = useCallback(async () => {
    const res = await recorder.start();
    if (res.ok) return;
    toast.error(
      res.reason === "denied"
        ? "Microphone access is blocked — allow it in your browser's site settings to record voice messages"
        : res.reason === "no-mic"
          ? "No microphone found"
          : res.reason === "unsupported"
            ? "Voice messages aren't supported in this browser"
            : "Couldn't start recording",
    );
  }, [recorder]);

  // Stop → encode (mp3, or mp4 as-is on Safari) → upload via the same
  // scope-tagged chip discipline as file uploads → stage a `voiceRecording`
  // attachment (Stream's default Attachment renders it as a player).
  const finishVoiceRecording = useCallback(async () => {
    if (!channel) return;
    const scope = scopeKey;
    const result = await recorder.stop();
    if (!result) {
      toast.error("Couldn't process the recording");
      return;
    }
    // Channel switched while recording/encoding — the scope effect already
    // cancelled the draft; drop the result instead of misfiling it.
    if (scopeRef.current !== scope) return;
    const { file } = result;
    const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setUploads((u) => [
      ...u,
      { id, name: "Voice message", progress: "uploading" },
    ]);
    try {
      const res = await channel.sendFile(file, file.name, result.mimeType);
      const url = (res as { file: string }).file;
      const attachment: QueuedAttachment = {
        _id: id,
        type: "voiceRecording",
        asset_url: url,
        title: file.name,
        duration: result.durationSeconds,
        mime_type: result.mimeType,
        file_size: file.size,
        waveform_data: result.waveformData,
      };
      if (scopeRef.current !== scope) return;
      setAttachments((a) => [...a, attachment]);
      setUploads((u) => u.filter((x) => x.id !== id));
    } catch (err) {
      console.error("voice message upload failed", err);
      toast.error("Upload failed: voice message");
      if (scopeRef.current !== scope) return;
      setUploads((u) =>
        u.map((x) => (x.id === id ? { ...x, progress: "error" } : x)),
      );
    }
  }, [channel, recorder, scopeKey]);

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void uploadFiles(files);
  }

  function removeAttachment(id: string) {
    setAttachments((a) => a.filter((x) => x._id !== id));
  }

  function dismissUpload(id: string) {
    setUploads((u) => u.filter((x) => x.id !== id));
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────
  // The drop target is the whole panel this composer lives in (main channel
  // window or thread panel), not just the composer strip — matching the
  // Slack habit of dropping a file anywhere over the conversation. Falls
  // back to the composer root when neither panel ancestor exists (threads
  // feed cards).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const panel =
      root.closest<HTMLElement>(".str-chat__thread, .str-chat__main-panel") ??
      root;
    // dragenter/dragleave fire for every descendant crossed; keep a depth
    // counter so the highlight only clears when the pointer truly leaves.
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void uploadFiles(files);
    };
    panel.addEventListener("dragenter", onDragEnter);
    panel.addEventListener("dragover", onDragOver);
    panel.addEventListener("dragleave", onDragLeave);
    panel.addEventListener("drop", onDrop);
    return () => {
      panel.removeEventListener("dragenter", onDragEnter);
      panel.removeEventListener("dragover", onDragOver);
      panel.removeEventListener("dragleave", onDragLeave);
      panel.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  // ── Render ────────────────────────────────────────────────────────────
  const isEditorEmpty = editorRef.current?.isEmpty() ?? true;
  const uploading = uploads.some((u) => u.progress === "uploading");
  const canSend =
    (!isEditorEmpty || attachments.length > 0) &&
    !sending &&
    !uploading &&
    !recorderActive;

  return (
    <div
      ref={rootRef}
      className={cn(
        "group/composer mx-4 mt-2 mb-4 flex flex-col rounded-md bg-transparent shadow-composer transition-[box-shadow] focus-within:shadow-composer-focus",
        dragActive && "shadow-composer-focus",
      )}
    >
      {/* Drop hint — the whole panel accepts the drop; this is the cue. */}
      {dragActive && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <Plus className="size-3.5" />
          Drop files to attach
        </div>
      )}
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
          {uploads.map((u) =>
            u.progress === "error" ? (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
              >
                <CircleAlert className="size-3.5" />
                <span className="max-w-[140px] truncate">{u.name}</span>
                <span className="whitespace-nowrap">failed</span>
                <button
                  type="button"
                  aria-label="Dismiss failed upload"
                  onClick={() => dismissUpload(u.id)}
                  className="ml-1 inline-flex size-4 items-center justify-center rounded-sm transition-colors hover:bg-destructive/15"
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                <Skeleton className="size-3 rounded-sm bg-muted-foreground/40" />
                <span className="max-w-[140px] truncate">{u.name}</span>
              </div>
            ),
          )}
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

      {/* Recording strip — visually replaces the editor row while a voice
          message is being recorded/encoded. The editor stays mounted (just
          hidden) so any draft text survives the recording. */}
      {recorderActive && (
        <div className="flex items-center gap-3 px-[17px] py-[13px]">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-red opacity-50" />
            <span className="relative inline-flex size-2.5 rounded-full bg-accent-red" />
          </span>
          <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatAudioDuration(recorder.elapsedMs / 1000)}
          </span>
          <div
            className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
            aria-hidden="true"
          >
            {recorder.amplitudes.slice(-48).map((v, i) => (
              <span
                key={i}
                className="w-[3px] shrink-0 rounded-full bg-foreground/50"
                style={{ height: `${Math.max(12, Math.round(v * 100))}%` }}
              />
            ))}
          </div>
          {recorder.status === "processing" ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              Processing…
            </span>
          ) : (
            <ToolbarGroup>
              <IconBtn
                label="Discard recording"
                onClick={() => recorder.cancel()}
              >
                <Trash2 />
              </IconBtn>
              <IconBtn
                label="Stop recording"
                onClick={() => void finishVoiceRecording()}
              >
                <CircleStop />
              </IconBtn>
            </ToolbarGroup>
          )}
        </div>
      )}

      {/* Editor (mention popover anchored on the wrapper) */}
      <div className={cn("px-[17px] py-[13px]", recorderActive && "hidden")}>
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
                  onChange={() => {
                    bumpRender((n) => n + 1);
                    // Only signal typing when there's content: `clear()` also
                    // fires onChange (after send, and on the channel-switch
                    // draft reset), and a keystroke there would show a
                    // phantom "is typing" to everyone else.
                    if (!editorRef.current?.isEmpty()) notifyTyping();
                  }}
                  onPasteFiles={(files) => void uploadFiles(files)}
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
            // Typeahead, not a dialog: the caret must stay in the editor so
            // the user can keep typing to filter. `initialFocus={false}`
            // stops Base UI moving focus into the popup when it opens;
            // `finalFocus={false}` stops it yanking focus to the trigger on
            // close (keyboard-committed mentions leave focus in the editor,
            // and click-committed ones re-focus it in replaceRangeWithMention).
            initialFocus={false}
            finalFocus={false}
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
            <IconBtn
              label="Attach files"
              onClick={pickFiles}
              disabled={recorderActive}
            >
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Emoji"
                    title="Emoji"
                    className="text-muted-foreground hover:bg-accent"
                  >
                    <Smile />
                  </Button>
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
            <IconBtn
              label={
                recorder.status === "recording"
                  ? "Stop recording"
                  : "Record voice message"
              }
              active={recorderActive}
              disabled={recorder.status === "processing"}
              onClick={() => {
                if (recorder.status === "recording") {
                  void finishVoiceRecording();
                } else if (recorder.status === "idle") {
                  void startVoiceRecording();
                }
              }}
            >
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Send message"
            onClick={() => void submit()}
            disabled={!canSend}
            className={cn(
              "disabled:opacity-100",
              canSend
                ? "text-foreground hover:bg-accent"
                : "text-muted-foreground/60 group-focus-within/composer:text-foreground/65 dark:group-focus-within/composer:text-muted-foreground",
            )}
          >
            <Send />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Send options"
            className="text-muted-foreground group-focus-within/composer:text-foreground hover:bg-accent"
          >
            <ChevronDown />
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFilesPicked}
      />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-4 w-px shrink-0 bg-border"
    />
  );
}

function IconBtn({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => {
        // Keep the editor focused so execCommand has a valid selection.
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        active
          ? "bg-accent-pressed text-foreground hover:bg-accent-pressed"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </Button>
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
  const isVoice = attachment.type === "voiceRecording";
  const title = isVoice
    ? `Voice message${
        attachment.duration
          ? ` · ${formatAudioDuration(attachment.duration)}`
          : ""
      }`
    : ((attachment.fallback as string | undefined) ??
      (attachment.title as string | undefined) ??
      "attachment");
  return (
    <div className="group relative inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
      {isImage && attachment.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.thumb_url ?? attachment.image_url}
          alt=""
          className="size-6 rounded-md object-cover"
        />
      ) : isVoice ? (
        <Mic className="size-3.5 text-muted-foreground" />
      ) : (
        <FileText className="size-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[160px] truncate">{title}</span>
      <button
        type="button"
        aria-label="Remove attachment"
        onClick={onRemove}
        className="ml-1 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent"
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
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                i === index
                  ? "bg-accent text-foreground"
                  : "text-foreground",
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
                  <AvatarFallback className="text-xs">
                    {initials || "?"}
                  </AvatarFallback>
                </Avatar>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  @{u.name ?? u.id}
                </span>
                {u.description ? (
                  <span className="truncate text-xs text-muted-foreground">
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
