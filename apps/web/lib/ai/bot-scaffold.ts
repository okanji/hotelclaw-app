import "server-only";
import { BOT_DISPLAY_NAME, BOT_USER_ID } from "./bot-identity";
/**
 * Liveblocks Comments bot powered by the Vercel `chat` package +
 * `@liveblocks/chat-sdk-adapter`. Responds to @mentions in document/task
 * comment threads with a Claude-generated reply.
 *
 * Wiring:
 *   • This module owns the `Chat` instance and the adapter.
 *   • `app/api/liveblocks/webhook/route.ts` forwards comment events to
 *     `bot.webhooks.liveblocks(request)`.
 *   • Mentions trigger `onNewMention` below, which:
 *       1. 👀-reacts immediately for feedback
 *       2. Decodes the thread id → roomId → propertyId + documentId
 *       3. Fetches the surrounding comment thread for conversation history
 *       4. Pulls the document title from Supabase for grounding context
 *       5. Calls Claude via the AI SDK with property-scoped tools enabled
 *       6. Posts the reply as a new comment in the same thread
 *
 * Env vars (server-only):
 *   LIVEBLOCKS_SECRET_KEY        — REST key (already set for room admin).
 *   LIVEBLOCKS_WEBHOOK_SECRET    — signing secret (already set).
 *   LIVEBLOCKS_BOT_USER_ID       — defaults to BOT_USER_ID.
 *   ANTHROPIC_API_KEY            — provider key for the reply model.
 *   LIVEBLOCKS_BOT_MODEL         — Anthropic model id, defaults to Sonnet 4.6.
 *
 * Reference: https://liveblocks.io/blog/chat-sdk-adapter-for-liveblocks
 */
import { Chat, type Message } from "chat";
type AnyMessage = Message<unknown>;
import {
  createLiveblocksAdapter,
  type LiveblocksAdapter,
} from "@liveblocks/chat-sdk-adapter";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMemoryState } from "./memory-state";
import { buildPropertyTools } from "./tools";
import { runBot } from "./run-bot";
import { createServiceClient } from "@/lib/supabase/server";

type Bot = Chat<{ liveblocks: LiveblocksAdapter }>;

let _bot: Bot | null = null;

const MODEL_ID_DEFAULT = "claude-sonnet-4-6";
const HISTORY_LIMIT = 20;

function getBotUserId(): string {
  return process.env.LIVEBLOCKS_BOT_USER_ID ?? BOT_USER_ID;
}

function getBotModelId(): string {
  return process.env.LIVEBLOCKS_BOT_MODEL ?? MODEL_ID_DEFAULT;
}

function buildBot(): Bot {
  const apiKey = process.env.LIVEBLOCKS_SECRET_KEY;
  const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    throw new Error(
      "LIVEBLOCKS_SECRET_KEY and LIVEBLOCKS_WEBHOOK_SECRET must be set to start the Liveblocks comment bot.",
    );
  }
  const botUserId = getBotUserId();
  const adapter = createLiveblocksAdapter({
    apiKey,
    webhookSecret,
    botUserId,
    botUserName: BOT_DISPLAY_NAME,
  });
  const bot = new Chat<{ liveblocks: LiveblocksAdapter }>({
    userName: BOT_DISPLAY_NAME,
    adapters: { liveblocks: adapter },
    state: createMemoryState(),
  });

  bot.onNewMention(async (thread, message) => {
    // Immediate ack so the author knows the bot saw the mention even if
    // generation is slow or fails.
    try {
      await thread.adapter.addReaction(thread.id, message.id, "👀");
    } catch (err) {
      console.error("[liveblocks-bot] reaction failed", err);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      await thread.post(
        "I need `ANTHROPIC_API_KEY` configured to respond — ask an admin to set it up.",
      );
      return;
    }

    try {
      // Decode the encoded thread id (format: `liveblocks:{roomId}:{threadId}`)
      // to get the originating Liveblocks roomId, which encodes the property
      // and the document/task this thread is attached to.
      const { roomId } = adapter.decodeThreadId(thread.id);
      const context = await resolveRoomContext(roomId);
      if (!context.propertyId) {
        // Without a property scope we can't safely use tools — fall back to
        // a no-tools reply so the bot is still helpful but can't read data.
        await postReply({
          thread,
          systemPrompt: baseSystemPrompt(),
          history: await loadThreadHistory(
            thread as unknown as { id: string; adapter: LiveblocksAdapter },
            message,
          ),
        });
        return;
      }

      const tools = buildPropertyTools(context.propertyId);
      const history = await loadThreadHistory(
        thread as unknown as { id: string; adapter: LiveblocksAdapter },
        message,
      );
      // Through runBot so the shared runtime applies: gbrain + delegate
      // tools auto-injected, uniform model settings and deferral guard.
      const result = await runBot({
        persona: groundedSystemPrompt(context),
        scopedTools: tools,
        messages: history,
        scope: {
          propertyId: context.propertyId,
          userId: message.author.userId,
          surface: "comment-thread",
        },
      });
      await thread.post(result.text.trim() || "(no reply)");
    } catch (err) {
      console.error("[liveblocks-bot] onNewMention failed", err);
      await thread.post(
        "I hit an error generating that reply — try again in a moment.",
      );
    }
  });

  return bot;
}

export function getCommentBot(): Bot {
  if (!_bot) _bot = buildBot();
  return _bot;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type RoomContext = {
  propertyId: string | null;
  /** The thing the thread is attached to. */
  scope: { kind: "document" | "task" | "board" | "calendar"; id?: string } | null;
  /** Human-readable label of the scope (e.g. document title) for grounding. */
  scopeLabel: string | null;
};

/**
 * Map a Liveblocks roomId (e.g. `property:<pid>:doc:<did>`) to property +
 * scope. The roomId conventions here mirror `lib/liveblocks/rooms.ts`.
 */
async function resolveRoomContext(roomId: string): Promise<RoomContext> {
  const parts = roomId.split(":");
  if (parts[0] !== "property" || !parts[1]) {
    return { propertyId: null, scope: null, scopeLabel: null };
  }
  const propertyId = parts[1];
  const kind = parts[2];
  const id = parts[3];

  if (kind === "doc" && id) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("documents")
      .select("title")
      .eq("id", id)
      .maybeSingle();
    return {
      propertyId,
      scope: { kind: "document", id },
      scopeLabel: data?.title ?? null,
    };
  }
  if (kind === "task" && id) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("tasks")
      .select("title")
      .eq("id", id)
      .maybeSingle();
    return {
      propertyId,
      scope: { kind: "task", id },
      scopeLabel: data?.title ?? null,
    };
  }
  if (kind === "tasks") {
    return { propertyId, scope: { kind: "board" }, scopeLabel: null };
  }
  if (kind === "calendar") {
    return { propertyId, scope: { kind: "calendar" }, scopeLabel: null };
  }
  return { propertyId, scope: null, scopeLabel: null };
}

function baseSystemPrompt(): string {
  return [
    `You are ${BOT_DISPLAY_NAME}, a teammate replying inside a Liveblocks comment thread.`,
    "Be concise: 1-3 sentences by default. Be actionable. If you don't know, say so plainly.",
  ].join(" ");
}

function groundedSystemPrompt(ctx: RoomContext): string {
  // Don't enumerate tools — the SDK auto-injects schemas and the model reads
  // them. Tool selection guidance belongs in the tool descriptions themselves
  // (see lib/ai/tools.ts). The system prompt here is for grounding (which
  // document/task this thread is attached to) and tone/behavior.
  const lines = [baseSystemPrompt()];
  if (ctx.scope?.kind === "document" && ctx.scopeLabel) {
    lines.push(
      `This thread is attached to a document titled "${ctx.scopeLabel}".`,
    );
  } else if (ctx.scope?.kind === "task" && ctx.scopeLabel) {
    lines.push(
      `This thread is attached to a task titled "${ctx.scopeLabel}".`,
    );
  } else if (ctx.scope?.kind === "board") {
    lines.push("This thread is attached to the tasks board for this property.");
  } else if (ctx.scope?.kind === "calendar") {
    lines.push("This thread is attached to the calendar for this property.");
  }
  lines.push(
    "When the user asks about specific property data, use the available tools rather than guessing. If a tool returns 0 results, say so plainly — never fabricate.",
  );
  return lines.join(" ");
}

/**
 * Pull the parent thread's comments and turn them into a multi-turn message
 * array. The triggering comment is always included as the last user turn —
 * even if the adapter's history doesn't have it yet (eventual consistency).
 */
async function loadThreadHistory(
  thread: { id: string; adapter: LiveblocksAdapter },
  triggerMessage: AnyMessage,
): Promise<ModelMessage[]> {
  let messages: AnyMessage[] = [];
  try {
    const res = await thread.adapter.fetchMessages(thread.id, {
      limit: HISTORY_LIMIT,
    });
    messages = res.messages ?? [];
  } catch (err) {
    console.error("[liveblocks-bot] fetchMessages failed", err);
  }
  const botUserId = getBotUserId();
  const turns: ModelMessage[] = [];
  for (const m of messages) {
    const text = (m.text ?? "").trim();
    if (!text) continue;
    if (m.author.userId === botUserId) {
      turns.push({ role: "assistant", content: text });
    } else {
      turns.push({
        role: "user",
        content: prefixUser(m.author.userName, text),
      });
    }
  }
  // Make sure the trigger comment is the last user turn.
  const triggerText = (triggerMessage.text ?? "").trim();
  const lastTurn = turns[turns.length - 1];
  const triggerLine = prefixUser(triggerMessage.author.userName, triggerText);
  if (
    triggerText &&
    (!lastTurn || lastTurn.role !== "user" || lastTurn.content !== triggerLine)
  ) {
    turns.push({ role: "user", content: triggerLine });
  }
  return turns;
}

function prefixUser(userName: string | undefined | null, text: string): string {
  const speaker = (userName ?? "").trim() || "Someone";
  return `${speaker}: ${text}`;
}

/**
 * Generate and post the reply. Single round trip — Liveblocks Comments
 * doesn't support streaming partial messages, so we generate fully and
 * post once.
 */
async function postReply(args: {
  thread: { post: (text: string) => Promise<unknown> };
  systemPrompt: string;
  history: ModelMessage[];
  tools?: ReturnType<typeof buildPropertyTools>;
}) {
  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  // stopWhen: default is stepCountIs(1) which means tool calls execute but
  // the model never gets a synthesis pass with the results. Need ≥2; 5
  // allows chained tool calls without unbounded loops.
  // temperature: 0 for deterministic tool-arg generation (AI SDK rec).
  const { text } = await generateText({
    model: anthropic(getBotModelId()),
    system: args.systemPrompt,
    messages: args.history,
    tools: args.tools,
    temperature: 0,
    stopWhen: stepCountIs(5),
  });
  await args.thread.post(text.trim() || "(no reply)");
}

/**
 * Compatibility shim for callers that only need the bot id.
 */
export type BotScaffold = { readonly stage: "ready"; readonly userId: string };

export function getBotScaffold(): BotScaffold {
  return { stage: "ready", userId: getBotUserId() };
}
