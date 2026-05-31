"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  ChevronDown,
  X,
  Copy,
  CornerDownLeft,
} from "lucide-react";
import { toast } from "sonner";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";

/**
 * Document AI assistant — bottom-anchored chat dock inside the editor.
 *
 * Layout: input bar pinned to the bottom-center of the editor area, always
 * visible. Sending a message expands a transcript above the input; collapse
 * with the chevron. POSTs to /api/properties/:propertyId/documents/:documentId/ai
 * (`runDocBot()`), which reads live Yjs content via captureDocumentSnapshot,
 * so the bot sees what the user is currently looking at.
 *
 * The bot can also WRITE: when the user asks it to draft/add/rewrite, the
 * reply carries an `edit` (mode + HTML) which renders an "Insert into
 * document" action. Insertion happens client-side against the live Tiptap
 * editor, so the change syncs to every collaborator through Yjs.
 *
 * Conversation lives in component state and is re-sent each turn — no
 * server-side persistence (doc conversations are short and per-session).
 */

/** A drafted change the bot staged — mirrors `ProposedDocEdit` server-side. */
type DocEdit = {
  op: "add" | "edit";
  mode: "insert" | "append";
  html: string;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns where the bot staged a document change. */
  edit?: DocEdit | null;
};

/** Drop a leading title heading the bot may have echoed — the title node is
 *  separate from the body, so including it would duplicate the title. */
function stripLeadingTitle(html: string): string {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
}

export function DocumentAiPanel({
  propertyId,
  documentId,
  editor,
}: {
  propertyId: string;
  documentId: string;
  editor: Editor | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!expanded) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, expanded]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setExpanded(true);
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/documents/${documentId}/ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Send the live HTML so the bot can reproduce unchanged blocks and
          // the inline diff only highlights what actually changed.
          body: JSON.stringify({
            messages: next,
            documentHtml: editor?.getHTML(),
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { reply, edit } = (await res.json()) as {
        reply: string;
        edit?: DocEdit | null;
      };
      setTurns((t) => [...t, { role: "assistant", content: reply, edit }]);
      if (edit) applyEdit(edit);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't reach the doc assistant",
      );
      setTurns((t) => t.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTurns([]);
    setExpanded(false);
    setInput("");
  }

  /** Stage a drafted change as an inline diff the user reviews in the doc.
   *  `edit` rewrites → block-level red/green diff; `add` → green pending
   *  insertion. Clears any prior pending suggestion first so they don't stack.
   *  The write goes through Yjs, so collaborators see the proposal too. */
  function applyEdit(edit: DocEdit) {
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().rejectAiEdit().run(); // clear any prior pending diff
    if (edit.op === "edit") {
      editor.commands.previewAiReplace(stripLeadingTitle(edit.html));
    } else {
      editor.commands.previewAiInsert(edit.html, edit.mode === "append");
    }
  }

  async function copyEdit(html: string) {
    try {
      // Copy as plain text (strip tags) — the editor already owns the rich
      // version via Insert; clipboard is the manual-paste fallback.
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col">
        {expanded && hasConversation ? (
          <div className="mb-2 flex flex-col overflow-hidden rounded-xl border border-border/60 bg-popover/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
            <header className="flex items-center justify-between border-b border-border/40 px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <Sparkles className="size-4" />
                Document assistant
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  aria-label="Clear conversation"
                  title="Clear conversation"
                >
                  <X className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
                    "rounded-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                    t.role === "user"
                      ? "ml-10 border border-border/60 bg-background text-foreground"
                      : "mr-10 bg-foreground/[0.04] text-foreground",
                  )}
                >
                  {t.content}
                  {t.role === "assistant" && t.edit ? (
                    <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-border/40 pt-2">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Sparkles className="size-3.5 text-violet-500" />
                        Changes highlighted in the doc — Accept or Reject above
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => applyEdit(t.edit!)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
                          title="Show these changes in the document again"
                        >
                          <CornerDownLeft className="size-3.5" />
                          Re-apply
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyEdit(t.edit!.html)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
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
                <div className="mr-10 flex items-center gap-2 rounded-md px-3 py-2 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking…
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border/60 bg-popover/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80",
          )}
          onClick={() => {
            if (hasConversation && !expanded) setExpanded(true);
          }}
        >
          <Sparkles className="ml-1 mb-1.5 size-4 shrink-0 text-muted-foreground" />
          <textarea
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
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            disabled={busy}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void send();
            }}
            disabled={busy || !input.trim()}
            className="rounded-md bg-foreground p-1.5 text-background transition disabled:opacity-40"
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
}
