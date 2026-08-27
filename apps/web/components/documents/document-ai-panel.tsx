"use client";

/**
 * Document AI assistant — bottom-anchored chat dock inside the editor.
 *
 * Conversations are PERSISTENT and MULTI-CHAT (migration 0031): each document
 * has any number of named chats with full history. The dock's header carries a
 * chat switcher (past chats + "New chat" + delete); selecting one loads its
 * messages from the server. Sending posts a single new message + the target
 * chatId — the server owns history, runs `runDocBot`, persists both turns, and
 * returns the reply.
 *
 * The bot can also WRITE: a reply may carry an `edit` (op + HTML). It's applied
 * immediately as an inline red/green diff (see lib/documents/ai-suggestion.ts)
 * reviewed via the floating AiReviewBar; "Re-apply" re-stages it.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Sparkles,
  Send,
  Loader2,
  ChevronDown,
  Plus,
  MessageSquarePlus,
  Trash2,
  Copy,
  CornerDownLeft,
} from "lucide-react";
import { AiLoader } from "@/components/ui/ai-loader";
import { toast } from "sonner";
import type { Editor } from "@tiptap/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { collapseEmptyDocParagraphs } from "@/lib/documents/normalize-doc-html";

type DocEdit = { op: "add" | "edit"; mode: "insert" | "append"; html: string };

type Turn = {
  role: "user" | "assistant";
  content: string;
  edit?: DocEdit | null;
};

type ChatSummary = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

/** Drop a leading title heading the bot may have echoed — the title node is
 *  separate from the body, so including it would duplicate the title. */
function stripLeadingTitle(html: string): string {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export type DocumentAiPanelHandle = {
  /**
   * Open the dock and ask the assistant to explain the given passage (or the
   * whole document when empty) in a fresh chat thread. Used by the toolbar's
   * "Explain" button — Explain is a read action, so it routes here instead of
   * the inline edit pipeline (which would stage the answer into the doc).
   */
  explain: (selection: string) => void;
  /**
   * Open the dock and ask the assistant to draft the whole document from a
   * plain-language brief. Used by the "Generate doc" flow: the new doc opens
   * and the draft lands as a staged AI suggestion the user accepts (same
   * review pipeline as every other edit).
   */
  generate: (brief: string) => void;
};

export const DocumentAiPanel = forwardRef<
  DocumentAiPanelHandle,
  {
    propertyId: string;
    documentId: string;
    editor: Editor | null;
  }
>(function DocumentAiPanel({ propertyId, documentId, editor }, ref) {
  const [expanded, setExpanded] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const base = `/api/properties/${propertyId}/documents/${documentId}/ai`;

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!expanded) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, expanded]);

  const fetchChats = useCallback(async () => {
    try {
      const res = await fetch(`${base}/chats`);
      if (!res.ok) return;
      const { chats } = (await res.json()) as { chats: ChatSummary[] };
      setChats(chats);
    } catch {
      /* best-effort */
    }
  }, [base]);

  // Load the chat list once on mount. State is only set in the async `.then`
  // continuations (never synchronously in the effect body).
  useEffect(() => {
    let on = true;
    fetch(`${base}/chats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chats: ChatSummary[] } | null) => {
        if (on && d) setChats(d.chats);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [base]);

  async function selectChat(id: string) {
    setChatsOpen(false);
    if (id === activeChatId) return;
    setActiveChatId(id);
    setTurns([]);
    try {
      const res = await fetch(`${base}/chats/${id}`);
      if (!res.ok) throw new Error();
      const { messages } = (await res.json()) as {
        messages: { role: "user" | "assistant"; content: string; edit: DocEdit | null }[];
      };
      setTurns(messages.map((m) => ({ role: m.role, content: m.content, edit: m.edit })));
    } catch {
      toast.error("Couldn't load that chat");
    }
  }

  function newChat() {
    setChatsOpen(false);
    setActiveChatId(null);
    setTurns([]);
    setInput("");
  }

  async function deleteChat(id: string) {
    setChats((c) => c.filter((x) => x.id !== id));
    if (id === activeChatId) newChat();
    try {
      await fetch(`${base}/chats/${id}`, { method: "DELETE" });
    } catch {
      void fetchChats(); // resync on failure
    }
  }

  /** Stage a drafted change as an inline diff the user reviews in the doc.
   *  Clears any prior pending suggestion first so they don't stack. */
  const applyEdit = useCallback(
    (edit: DocEdit) => {
      if (!editor || editor.isDestroyed) return;
      editor.chain().focus().rejectAiEdit().run();
      const html = collapseEmptyDocParagraphs(edit.html);
      if (edit.op === "edit") {
        editor.commands.previewAiReplace(stripLeadingTitle(html));
      } else {
        editor.commands.previewAiInsert(html, edit.mode === "append");
      }
    },
    [editor],
  );

  /** Post a message and stream the reply into the transcript. `freshChat`
   *  forces a brand-new thread (used by Explain so the answer never lands in
   *  an unrelated conversation) and keeps the input box untouched on failure. */
  const submit = useCallback(
    async (raw: string, opts?: { freshChat?: boolean }) => {
      const text = raw.trim();
      if (!text || busy) return;
      const fresh = opts?.freshChat ?? false;
      const chatId = fresh ? undefined : activeChatId ?? undefined;
      if (fresh) {
        setActiveChatId(null);
        setChatsOpen(false);
      }
      setExpanded(true);
      setTurns((t) => [...(fresh ? [] : t), { role: "user", content: text }]);
      setInput("");
      setBusy(true);
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            message: text,
            documentHtml: editor?.getHTML(),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const { chatId: id, reply, edit } = (await res.json()) as {
          chatId: string;
          title: string | null;
          reply: string;
          edit?: DocEdit | null;
        };
        setActiveChatId(id);
        setTurns((t) => [...t, { role: "assistant", content: reply, edit }]);
        if (edit) applyEdit(edit);
        void fetchChats(); // refresh titles + ordering (and surface a new chat)
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Couldn't reach the doc assistant",
        );
        setTurns((t) => t.slice(0, -1));
        if (!fresh) setInput(text);
      } finally {
        setBusy(false);
      }
    },
    [activeChatId, busy, base, editor, applyEdit, fetchChats],
  );

  const send = useCallback(() => void submit(input), [submit, input]);

  useImperativeHandle(
    ref,
    () => ({
      explain: (selection: string) => {
        const trimmed = selection.trim().slice(0, 4000);
        const message = trimmed
          ? `Explain this passage from the document in plain language. Be concise:\n\n"""\n${trimmed}\n"""`
          : "Explain what this document is about in plain language. Be concise.";
        void submit(message, { freshChat: true });
      },
      generate: (brief: string) => {
        const trimmed = brief.trim().slice(0, 2000);
        if (!trimmed) return;
        const message = `Draft a complete first version of this document. Use a clear title, headings, short paragraphs, and lists where they help. Write the actual content (not an outline of what you'd write).\n\nWhat the document should cover:\n"""\n${trimmed}\n"""`;
        void submit(message, { freshChat: true });
      },
    }),
    [submit],
  );

  async function copyEdit(html: string) {
    try {
      const text = html
        .replace(/<\/(h[1-3]|p|li|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  const hasConversation = turns.length > 0 || busy;
  const activeChat = chats.find((c) => c.id === activeChatId);
  const activeTitle = activeChat?.title ?? "New chat";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col">
        {expanded && hasConversation ? (
          <div className="mb-2 flex flex-col overflow-hidden rounded-overlay bg-popover shadow-overlay">
            <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
              {/* Chat switcher */}
              <Popover open={chatsOpen} onOpenChange={setChatsOpen}>
                <PopoverTrigger
                  render={(props) => (
                    <button
                      {...props}
                      type="button"
                      className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <Sparkles className="size-4 shrink-0 text-icon-accent" />
                      <span className="truncate">{activeTitle}</span>
                      <ChevronDown className="size-3.5 shrink-0 text-faint-foreground" />
                    </button>
                  )}
                />
                <PopoverContent
                  align="start"
                  side="top"
                  sideOffset={6}
                  className="!w-72 !p-1"
                >
                  <button
                    type="button"
                    onClick={newChat}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-sm/[1.2] text-foreground transition-colors hover:bg-accent"
                  >
                    <MessageSquarePlus className="size-4" />
                    New chat
                  </button>
                  {chats.length > 0 ? (
                    <div className="-mx-1 my-1 h-px bg-border" />
                  ) : null}
                  <div className="max-h-64 overflow-y-auto">
                    {chats.map((c) => (
                      <div
                        key={c.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors",
                          c.id === activeChatId
                            ? "bg-accent-pressed"
                            : "hover:bg-accent",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void selectChat(c.id)}
                          className="flex min-w-0 flex-1 flex-col items-start px-1.5 py-[3px] text-left"
                        >
                          <span className="w-full truncate text-foreground">
                            {c.title ?? "Untitled chat"}
                          </span>
                          <span className="text-xs text-faint-foreground">
                            {formatWhen(c.updated_at)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteChat(c.id)}
                          className="rounded-md p-1 text-faint-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          aria-label="Delete chat"
                          title="Delete chat"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={newChat}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
                  aria-label="New chat"
                  title="New chat"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
                  aria-label="Collapse"
                  title="Collapse"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </header>
            <div
              ref={transcriptRef}
              className="max-h-[50vh] space-y-2 overflow-y-auto p-3"
            >
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm leading-6 whitespace-pre-wrap",
                    t.role === "user"
                      ? "ml-10 bg-accent text-foreground"
                      : "mr-10 text-foreground",
                  )}
                >
                  {t.content}
                  {t.role === "assistant" && t.edit ? (
                    <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-border pt-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-faint-foreground">
                        <Sparkles className="size-3.5 text-icon-accent" />
                        Changes highlighted in the doc — Accept or Reject above
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => applyEdit(t.edit!)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                          title="Show these changes in the document again"
                        >
                          <CornerDownLeft className="size-3.5" />
                          Re-apply
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyEdit(t.edit!.html)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                        >
                          <Copy className="size-3.5" />
                          Copy
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              {busy ? (
                <div className="mr-10 px-3 py-2">
                  <AiLoader label="Thinking…" />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          className="flex items-end gap-2 rounded-overlay bg-popover p-2 shadow-overlay"
          onClick={() => {
            if (hasConversation && !expanded) setExpanded(true);
          }}
        >
          <Sparkles className="ml-1 mb-1.5 size-4 shrink-0 text-faint-foreground" />
          <textarea
            name="prompt"
            aria-label="Ask AI about this document"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            onFocus={() => {
              if (hasConversation) setExpanded(true);
            }}
            placeholder="Ask AI to write, edit, or explain this document…"
            rows={1}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-faint-foreground focus:outline-none"
            disabled={busy}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void send();
            }}
            disabled={busy || !input.trim()}
            className="rounded-md bg-primary p-1.5 text-primary-foreground transition-colors disabled:opacity-40"
            aria-label="Send"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
