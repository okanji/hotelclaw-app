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

function buildDocScopedTools(
  propertyId: string,
  documentId: string,
): ToolSet {
  const supabase = createServiceClient();

  return {
    get_document: tool({
      description:
        "Fetch the current document — title, full body text, when it was last edited and by whom, and whether it's archived. Call this once at the start of any conversation to ground yourself in what the user is looking at. body_text is the rendered prose of the doc (updated by the Liveblocks webhook within ~60 seconds of edits).",
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
          body_text: data.body_text ?? "",
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
  "Your goal: help them understand what's in this document, summarize sections, find action items, and reason about the discussion happening in its comment threads. You see the same document they do.",
  "Use `get_document` to read the live body + metadata. Use `list_doc_threads` to see what people are discussing inline. Stay tightly scoped to THIS document — don't fabricate content you can't see, and don't speculate about other documents.",
].join(" ");

export async function runDocBot(opts: {
  propertyId: string;
  userId: string;
  documentId: string;
  /** Conversation so far (user/assistant alternation). The bot generates the next assistant turn. */
  messages: ModelMessage[];
}): Promise<{ text: string }> {
  const result = await runBot({
    persona: DOC_BOT_PERSONA,
    activationReason: "mention",
    scopedTools: buildDocScopedTools(opts.propertyId, opts.documentId),
    messages: opts.messages,
    scope: {
      propertyId: opts.propertyId,
      userId: opts.userId,
      surface: "doc",
    },
  });
  return { text: result.text };
}
