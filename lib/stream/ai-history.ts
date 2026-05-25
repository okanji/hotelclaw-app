import "server-only";
/**
 * Shared chat-history builder for the AI bot's classifier and responder
 * passes. Both call into Stream for the last N messages and shape them
 * into role-tagged turns with speaker names baked into user text.
 *
 * Two scopes:
 *   - loadChannelHistory: top-level messages (channel.query)
 *   - loadThreadHistory:  parent + replies for a thread (getReplies)
 *
 * Both produce the same `HistoryTurn[]` shape so callers can switch
 * scopes without touching downstream code.
 */
import type { Channel, MessageResponse } from "stream-chat";

export type StreamRole = "user" | "assistant";

export type HistoryTurn = {
  role: StreamRole;
  content: string;
};

export const DEFAULT_HISTORY_LIMIT = 10;

export async function loadChannelHistory(
  channel: Channel,
  botUserId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<HistoryTurn[]> {
  // `channel.query` pulls fresh state from the server. Without this the bot
  // would only see messages it already had cached — webhook processes spin
  // fresh each invocation, so there's no cache to read from.
  const state = await channel.query({
    messages: { limit },
  });
  const msgs = (state.messages ?? []) as MessageResponse[];
  const history: HistoryTurn[] = [];
  for (const m of msgs) {
    const text = (m.text ?? "").trim();
    if (!text) continue;
    if (m.user?.id === botUserId) {
      history.push({ role: "assistant", content: text });
    } else {
      history.push({
        role: "user",
        content: prefixUser({
          text,
          userName: m.user?.name ?? null,
          userId: m.user?.id ?? "unknown",
        }),
      });
    }
  }
  return history;
}

/**
 * Tag user messages with the speaker name so the model can address people
 * correctly in a multi-participant channel. Chat models treat the whole
 * `user` block as one speaker by default; without this, every message
 * looks like it's from the same user.
 */
export function prefixUser(m: {
  text: string;
  userName?: string | null;
  userId: string;
}): string {
  const speaker = m.userName?.trim() || m.userId;
  return `${speaker}: ${m.text}`;
}

/**
 * Load a thread's history: the parent message first (for grounding — a reply
 * is meaningless without knowing what it's replying to) followed by the
 * thread replies in chronological order.
 *
 * `channel.getReplies()` fetches the replies; the parent message comes from
 * a separate channel.query because the Stream SDK doesn't bundle it with
 * getReplies. The two calls are cheap and run in parallel.
 */
export async function loadThreadHistory(
  channel: Channel,
  parentId: string,
  botUserId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<HistoryTurn[]> {
  const [repliesRes, parentRes] = await Promise.all([
    channel.getReplies(parentId, { limit }),
    // Pull the parent message via channel.query with a tight id filter so
    // we don't refetch the whole channel timeline. messages.id_around lets
    // us anchor on the parent specifically.
    channel.query({
      messages: { limit: 1, id_around: parentId },
      watch: false,
      state: false,
    }),
  ]);

  const parent = (parentRes.messages ?? []).find(
    (m) => m.id === parentId,
  ) as MessageResponse | undefined;
  const replies = (repliesRes.messages ?? []) as MessageResponse[];

  const ordered: MessageResponse[] = [];
  if (parent) ordered.push(parent);
  ordered.push(...replies);

  return ordered
    .map((m) => toTurn(m, botUserId))
    .filter((t): t is HistoryTurn => t !== null);
}

function toTurn(m: MessageResponse, botUserId: string): HistoryTurn | null {
  const text = (m.text ?? "").trim();
  if (!text) return null;
  if (m.user?.id === botUserId) {
    return { role: "assistant", content: text };
  }
  return {
    role: "user",
    content: prefixUser({
      text,
      userName: m.user?.name ?? null,
      userId: m.user?.id ?? "unknown",
    }),
  };
}
