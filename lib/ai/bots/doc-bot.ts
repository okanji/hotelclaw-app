import "server-only";
/**
 * Document bot — Tier 1 in-app AI scoped to a single document.
 *
 * Lives inside the document editor. User asks things like:
 *   - "Summarize this doc"
 *   - "What are the action items in here?"
 *   - "What's the team discussing about this?"
 *   - "Who last edited this and when?"
 *
 * Persona + doc-scoped tools (get_document, list_doc_threads) plus the
 * runtime's shared gbrain + delegate tools. Document body comes from
 * the Supabase `documents` table — the Liveblocks webhook keeps
 * `body_text` synced via lib/documents/snapshot.ts (≤60s freshness),
 * so the bot reads what the user sees without a Yjs round-trip.
 *
 * Comment threads come from Liveblocks directly. Read-only — the
 * existing Liveblocks comment bot owns replying.
 */
import {
  runBot,
  tool,
  z,
  type ModelMessage,
  type ToolSet,
} from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import { captureDocumentSnapshot } from "@/lib/documents/snapshot";

/** A drafted edit the bot wants to apply to the document, captured from the
 *  `propose_document_content` tool so the route can hand it to the client. */
export type ProposedDocEdit = {
  /**
   * "add" → `html` is NEW content to insert (shown as a green pending block).
   * "edit" → `html` is the COMPLETE revised body; the client diffs it against
   * the live document and shows an inline red/green review.
   */
  op: "add" | "edit";
  /** For "add": at the cursor or appended to the doc end. Ignored for "edit". */
  mode: "insert" | "append";
  /** Ready-to-insert/revised HTML using the editor's supported tags. */
  html: string;
};

// Tags the Tiptap editor's schema actually understands (StarterKit + the
// extensions wired in document-editor.tsx). Anything else is unwrapped to its
// text so `insertContent` never receives nodes it can't parse.
const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "a",
  "hr",
  "br",
]);

/**
 * Defense-in-depth for the model's HTML: it's told to use a small tag set, but
 * LLMs love reaching for `<table>` + inline styles, which the editor (no Table
 * extension) would shred. This:
 *  - strips a stray markdown code fence,
 *  - degrades tables to bullet lists (rows → list items, cells → " · "),
 *  - normalizes b/i → strong/em,
 *  - removes every attribute except `href` on links,
 *  - unwraps any tag not in ALLOWED_TAGS (keeping its text).
 * Best-effort string surgery — good enough for well-formed model output.
 */
export function sanitizeDocHtml(input: string): string {
  let html = input.trim();

  const fence = html.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) html = fence[1].trim();

  // Tables → lists. Drop section wrappers, map rows to <li>, cells to a
  // separator, and the table itself to <ul>.
  html = html
    .replace(/<\/?(?:thead|tbody|tfoot|colgroup|col)[^>]*>/gi, "")
    .replace(/<table[^>]*>/gi, "<ul>")
    .replace(/<\/table>/gi, "</ul>")
    .replace(/<tr[^>]*>/gi, "<li>")
    .replace(/<\/tr>/gi, "</li>")
    .replace(/<(?:td|th)[^>]*>/gi, "")
    .replace(/<\/(?:td|th)>/gi, " · ");

  // b/i aliases → canonical marks.
  html = html
    .replace(/<(\/?)b\b[^>]*>/gi, "<$1strong>")
    .replace(/<(\/?)i\b[^>]*>/gi, "<$1em>");

  // Per-tag pass: strip attributes (keep href on <a>), unwrap unknown tags.
  html = html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_m, slash: string, rawTag: string, attrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return ""; // unwrap — keep inner text
      if (slash) return `</${tag}>`;
      if (tag === "a") {
        const href = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
        const url = href ? (href[2] ?? href[3] ?? "") : "";
        return url ? `<a href="${url}">` : "<a>";
      }
      return `<${tag}>`;
    },
  );

  // Tidy artifacts from the table→list mapping.
  html = html
    .replace(/ · (?=<\/li>)/g, "") // trailing cell separator
    .replace(/<li>\s*(?:·\s*)*<\/li>/g, "") // empty rows
    .replace(/<(ul|ol)>\s*<\/\1>/g, "") // empty lists
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return html;
}

function buildDocScopedTools(
  propertyId: string,
  documentId: string,
  /** Called when the bot drafts content to write into the doc. */
  onProposeEdit: (edit: ProposedDocEdit) => void,
): ToolSet {
  const supabase = createServiceClient();

  return {
    propose_document_content: tool({
      description:
        "Write to THIS document. Call this whenever the user asks you to draft, add, continue, expand, rewrite, reformat, fix, or change the document — anything where they want text to end up IN the doc rather than just an answer in chat. Do NOT call it for questions (summaries, 'what are the action items', 'who edited this') — answer those in plain text. The user reviews your change inline (added text in green, removed in red) and Accepts or Rejects it.",
      inputSchema: z.object({
        op: z
          .enum(["add", "edit"])
          .describe(
            "'add' when the user wants NEW content that doesn't replace anything (a new section, continue writing). 'edit' when they want to CHANGE existing content (rewrite, fix, reword, restructure, update a value, shorten/expand).",
          ),
        mode: z
          .enum(["insert", "append"])
          .describe(
            "Only used when op='add': 'insert' places it at the user's cursor, 'append' adds it at the end of the document.",
          ),
        html: z
          .string()
          .describe(
            "For op='add': ONLY the new content. For op='edit': the COMPLETE revised document body — every block from the CURRENT DOCUMENT HTML in your instructions, with your changes applied and everything else copied through UNCHANGED, and WITHOUT the title (the first <h1>). The app diffs this against the live document, so unchanged blocks must be reproduced verbatim or they'll show as spurious changes. Valid HTML using ONLY these tags: <h1> <h2> <h3> <p> <ul> <ol> <li> <blockquote> <strong> <em> <a> <hr>. NEVER use <table> — the editor cannot render tables. For schedules, timelines, checklists, or tabular data, use an <h3> sub-heading per group with a <ul> of '<strong>Field:</strong> value' items. No markdown, no code fences, no <html>/<body> wrapper, no inline styles, no emoji-as-bullets.",
          ),
      }),
      execute: async ({ op, mode, html }) => {
        onProposeEdit({ op, mode, html: sanitizeDocHtml(html) });
        // Tell the model the draft is staged so it finishes with a short
        // confirmation rather than dumping the content again as chat text.
        return {
          status: "drafted",
          note: "Change staged for the user to review inline. Reply with one short sentence — do not repeat the content.",
        };
      },
    }),

    get_document: tool({
      description:
        "Fetch the current document — title, full body text, when it was last edited and by whom, and whether it's archived. Call this once at the start of any conversation to ground yourself in what the user is looking at. Body text is read live from the collaborative Yjs state, so it reflects the user's exact current view (not a stale snapshot).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("documents")
          .select(
            "id, title, body_text, archived_at, created_at, updated_at, created_by, last_edited_by",
          )
          .eq("id", documentId)
          .eq("property_id", propertyId)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "document not found" };

        // Live body text from the Liveblocks Yjs room — what the user sees
        // RIGHT NOW, not the ~60s-stale snapshot in documents.body_text.
        // Falls back to the snapshot only if Liveblocks is unreachable.
        let body_text = data.body_text ?? "";
        try {
          const lb = getLiveblocksServer();
          const roomId = roomIdForDocument(propertyId, documentId);
          const snap = await captureDocumentSnapshot(lb, roomId);
          body_text = snap.bodyText;
        } catch (err) {
          console.warn(
            "[doc-bot] live Yjs read failed, falling back to snapshot",
            err,
          );
        }

        // Resolve last-editor name (documents.last_edited_by → auth.users,
        // no direct FK to profiles — same two-query pattern as task bot).
        let last_edited_by_name: string | null = null;
        if (data.last_edited_by) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", data.last_edited_by)
            .maybeSingle();
          last_edited_by_name = profile?.full_name ?? null;
        }

        return {
          title: data.title,
          body_text,
          last_edited_at: data.updated_at,
          last_edited_by_name,
          archived: data.archived_at != null,
        };
      },
    }),

    list_doc_threads: tool({
      description:
        "List comment threads on this document — what the team is discussing inline in the doc. Each thread has the first comment's author + a short snippet. Use when the user asks 'what's the team discussing about this', 'what are the open questions', 'who's commented on this'.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Max threads to return."),
      }),
      execute: async ({ limit }) => {
        try {
          const lb = getLiveblocksServer();
          const roomId = roomIdForDocument(propertyId, documentId);
          const page = await lb.getThreads({ roomId });
          const threads = page.data.slice(0, limit).map((thread) => {
            const first = thread.comments[0];
            const snippetSource = first?.body?.content
              ?.flatMap((block) =>
                "children" in block
                  ? block.children
                      .map((child) =>
                        child && typeof child === "object" && "text" in child
                          ? String((child as { text: unknown }).text ?? "")
                          : "",
                      )
                      .join("")
                  : "",
              )
              .join(" ")
              .trim();
            return {
              author_id: first?.userId ?? null,
              snippet: (snippetSource ?? "").slice(0, 240),
              resolved: thread.resolved === true,
              created_at: thread.createdAt,
            };
          });

          // Best-effort author-name resolution — Liveblocks returns userIds;
          // we look up display names from `profiles` in one batch.
          const ids = Array.from(
            new Set(
              threads
                .map((t) => t.author_id)
                .filter((id): id is string => typeof id === "string"),
            ),
          );
          const nameById = new Map<string, string>();
          if (ids.length > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", ids);
            for (const p of profiles ?? []) {
              if (p.full_name) nameById.set(p.id, p.full_name);
            }
          }

          return {
            count: threads.length,
            threads: threads.map((t) => ({
              author_name: t.author_id ? nameById.get(t.author_id) ?? null : null,
              snippet: t.snippet,
              resolved: t.resolved,
              created_at: t.created_at,
            })),
          };
        } catch (err) {
          console.error("[doc-bot] list_doc_threads failed", err);
          return {
            error:
              "Couldn't fetch comment threads — Liveblocks may be unreachable.",
          };
        }
      },
    }),
  };
}

const DOC_BOT_PERSONA = [
  "You are the document assistant for Hotelclaw — a focused AI scoped to a single document the user has open right now.",
  "You do two kinds of work. (1) ANSWER questions about this document — summarize sections, find action items, reason about its comment threads. (2) WRITE for the document — when the user asks you to draft, add, continue, expand, rewrite, fix, or reformat content, you produce the change and stage it for inline review.",
  "You CAN edit this document: call `propose_document_content`. The user sees your change highlighted inline (added text in green, removed in red) and Accepts or Rejects it — so never say you're unable to edit and never ask them to copy-paste. Use the tool for any write/edit request; answer questions in plain text instead.",
  "Choosing op: use op='edit' to CHANGE existing text (the html must be the COMPLETE revised body with unchanged blocks copied through verbatim, minus the title), and op='add' to introduce NEW content that replaces nothing.",
  "Use `list_doc_threads` to see what people are discussing inline. Stay tightly scoped to THIS document — don't fabricate facts you can't see. After staging a change, reply with one short sentence; don't repeat the content in chat.",
].join(" ");

export async function runDocBot(opts: {
  propertyId: string;
  userId: string;
  documentId: string;
  /** Conversation so far (user/assistant alternation). The bot generates the next assistant turn. */
  messages: ModelMessage[];
  /** Live document HTML from the client — grounds accurate full-body edits. */
  documentHtml?: string;
}): Promise<{ text: string; edit: ProposedDocEdit | null }> {
  // Capture the last change the bot stages via `propose_document_content` so
  // the route can return it to the client for inline review.
  let proposed: ProposedDocEdit | null = null;

  // Ground the bot in the exact current HTML so an op='edit' can reproduce
  // unchanged blocks verbatim (otherwise the diff shows spurious changes).
  const persona = opts.documentHtml
    ? `${DOC_BOT_PERSONA}\n\nCURRENT DOCUMENT HTML (the live document the user is looking at — for an op='edit', return this with your changes applied, unchanged blocks verbatim, minus the title):\n${opts.documentHtml.slice(0, 24000)}`
    : DOC_BOT_PERSONA;

  const result = await runBot({
    persona,
    activationReason: "mention",
    scopedTools: buildDocScopedTools(
      opts.propertyId,
      opts.documentId,
      (edit) => {
        proposed = edit;
      },
    ),
    messages: opts.messages,
    scope: {
      propertyId: opts.propertyId,
      userId: opts.userId,
      surface: "doc",
    },
  });
  return { text: result.text, edit: proposed };
}
