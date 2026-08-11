import { CLUSTER_TIME_GAP_MS, slackGroupStyles } from "@hotelclaw/chat-grouping";

export { CLUSTER_TIME_GAP_MS };

/** Mirrors stream-chat-react-native's `MessageGroupStylesParams`. */
type GroupStyleParams = {
  message: unknown;
  previousMessage?: unknown;
  nextMessage?: unknown;
  maxTimeBetweenGroupedMessages?: number;
  dateSeparatorDate?: Date;
  nextMessageDateSeparatorDate?: Date;
};

type GroupStyle = "" | "middle" | "top" | "bottom" | "single";

/**
 * Slack-style clustering for the RN message list, delegating to the SAME rules
 * web uses (`@hotelclaw/chat-grouping`) so the two clients can't drift: same
 * 2-minute gap, same "one eve turn is one cluster" rule, and the same refusal
 * to split a cluster just because a message carries an attachment or a
 * reaction.
 *
 * Two shape differences from web are handled here:
 *  - RN reports date separators as `dateSeparatorDate` params, where web
 *    injects them as rows into the message array. A separator must break the
 *    cluster, so translate it into an absent neighbour.
 *  - RN wants `GroupStyle[]`, web returns a single role.
 */
export function slackGetMessageGroupStyle(
  params: GroupStyleParams,
): GroupStyle[] {
  const {
    message,
    previousMessage,
    nextMessage,
    dateSeparatorDate,
    nextMessageDateSeparatorDate,
    maxTimeBetweenGroupedMessages = CLUSTER_TIME_GAP_MS,
  } = params;

  const role = slackGroupStyles(
    message,
    dateSeparatorDate ? undefined : previousMessage,
    nextMessageDateSeparatorDate ? undefined : nextMessage,
    false,
    maxTimeBetweenGroupedMessages,
  );

  return role ? [role] : [];
}
