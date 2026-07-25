/**
 * Slack-style message clustering for the chat surfaces.
 *
 * Pure logic, deliberately free of React/stream-chat-react imports so it can
 * be unit-tested — the grouping rules have drifted twice before (reactions
 * silently breaking clusters; the time-gap constant disagreeing between the
 * `<MessageList>` prop and the per-row recomputation), and both regressions
 * were invisible until someone looked at a screenshot.
 *
 * `slackGroupStyles` is a drop-in replacement for stream-chat-react's
 * `getGroupStyles`, passed to `<MessageList groupStyles>` AND reused by
 * `slack-message-ui.tsx` to resolve each row's own role, so the CSS classes
 * and the avatar/metadata decision cannot disagree.
 */

export type ClusterRole = "top" | "middle" | "bottom" | "single";

/**
 * Slack breaks message clusters when consecutive same-author messages are
 * more than ~2 min apart.
 */
export const CLUSTER_TIME_GAP_MS = 2 * 60 * 1000;

/**
 * Custom field the eve runtime stamps on every Stream message belonging to
 * one bot turn: the final reply, its continuation chunks, and the artifact /
 * form cards the tools post mid-turn (`turn_nonce` on
 * `channel_bot_sessions`). Same turn ⇒ same cluster, no matter how long the
 * turn ran — a long agent turn whose artifact cards land minutes before the
 * written answer still reads as ONE reply.
 */
export const TURN_FIELD = "eve_turn";

/**
 * Upstream predicates, reimplemented locally to keep this module dependency
 * free. Mirrors stream-chat-react v14.1:
 *   CUSTOM_MESSAGE_TYPE = { date: "message.date", intro: "channel.intro" }
 *   isMessageEdited = (m) => !!m.message_text_updated_at
 */
const CUSTOM_TYPE_DATE = "message.date";
const CUSTOM_TYPE_INTRO = "channel.intro";

function field(msg: unknown, key: string): unknown {
  if (!msg || typeof msg !== "object") return undefined;
  return (msg as Record<string, unknown>)[key];
}

/** Date separators and the channel intro are not real messages. */
export function isNonMessageRow(msg: unknown): boolean {
  const customType = field(msg, "customType");
  return customType === CUSTOM_TYPE_DATE || customType === CUSTOM_TYPE_INTRO;
}

function isEdited(msg: unknown): boolean {
  return !!field(msg, "message_text_updated_at");
}

export function messageCreatedAtMs(msg: unknown): number | null {
  const createdAt = field(msg, "created_at");
  if (createdAt == null) return null;
  const d =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string"
        ? new Date(createdAt)
        : new Date(String(createdAt));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function turnKey(msg: unknown): string | null {
  const value = field(msg, TURN_FIELD);
  return typeof value === "string" && value ? value : null;
}

function sameTurn(a: unknown, b: unknown): boolean {
  const keyA = turnKey(a);
  return keyA != null && keyA === turnKey(b);
}

function userId(msg: unknown): string | undefined {
  const user = field(msg, "user");
  if (!user || typeof user !== "object") return undefined;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Does `neighbor` end the cluster `msg` belongs to?
 *
 * This is upstream's top/bottom predicate with two rules deliberately
 * dropped, because Slack has neither:
 *
 * - **attachments** — upstream forces ANY message carrying an attachment to
 *   `single` (`message.attachments?.length !== 0`). Slack groups file
 *   uploads and cards under one header like any other message. That rule is
 *   why one agent turn that wrote five documents rendered as five separate
 *   replies, each with its own avatar / name / timestamp.
 * - **reactions** — upstream breaks the cluster on both the reacted message
 *   and its successor. Slack hangs reactions under the message without
 *   splitting anything.
 *
 * Every other rule (author change, system/error neighbor, edited, time gap)
 * is preserved.
 */
function breaksCluster(
  msg: unknown,
  neighbor: unknown,
  maxGapMs: number | undefined,
): boolean {
  if (!neighbor || typeof neighbor !== "object") return true;
  if (isNonMessageRow(neighbor)) return true;

  const neighborType = field(neighbor, "type");
  if (neighborType === "system" || neighborType === "error") return true;

  if (userId(msg) !== userId(neighbor)) return true;

  // One agent turn is one cluster, however long it took to finish.
  if (sameTurn(msg, neighbor)) return false;

  if (maxGapMs === undefined) return false;
  const selfMs = messageCreatedAtMs(msg);
  const neighborMs = messageCreatedAtMs(neighbor);
  if (selfMs == null || neighborMs == null) return false;
  return Math.abs(selfMs - neighborMs) > maxGapMs;
}

/**
 * Drop-in replacement for stream-chat-react's `getGroupStyles` — same
 * `(message, previousMessage, nextMessage, noGroupByUser, maxTime)`
 * signature, so it can be handed straight to `<MessageList groupStyles>`.
 */
export function slackGroupStyles(
  message: unknown,
  previousMessage?: unknown,
  nextMessage?: unknown,
  noGroupByUser?: boolean,
  maxTimeBetweenGroupedMessages?: number,
): ClusterRole | "" {
  if (!message || typeof message !== "object" || isNonMessageRow(message)) {
    return "";
  }
  if (noGroupByUser) return "single";
  if (field(message, "type") === "error") return "single";

  const isTop =
    breaksCluster(message, previousMessage, maxTimeBetweenGroupedMessages) ||
    isEdited(previousMessage);
  const isBottom =
    breaksCluster(message, nextMessage, maxTimeBetweenGroupedMessages) ||
    isEdited(message);

  if (isTop && isBottom) return "single";
  if (isTop) return "top";
  if (isBottom) return "bottom";
  return "middle";
}
