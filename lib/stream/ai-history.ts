import "server-only";
/**
 * Shared chat-history builder for the AI bot's classifier and responder
 * passes. Both call `channel.query()` for the last N messages and shape
 * them into role-tagged turns with speaker names baked into user text.
 *
 * Why this lives here: the auto-mode classifier needs the same history
 * the responder uses (so its decision is grounded in the same context),
 * but neither caller wants the responder's tools/system-prompt/streaming
 * machinery. Hoisting just the history pass keeps both consumers focused.
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
