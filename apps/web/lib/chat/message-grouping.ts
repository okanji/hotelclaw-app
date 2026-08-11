/**
 * Re-export shim. The clustering rules moved to `@hotelclaw/chat-grouping` so
 * apps/mobile runs the SAME code rather than a copy — these rules have drifted
 * twice before, and a second implementation would guarantee a third drift.
 *
 * Existing web imports (`@/lib/chat/message-grouping`) and the unit tests in
 * `./__tests__/message-grouping.test.ts` keep working unchanged.
 */
export {
  CLUSTER_TIME_GAP_MS,
  TURN_FIELD,
  isNonMessageRow,
  messageCreatedAtMs,
  slackGroupStyles,
  type ClusterRole,
} from "@hotelclaw/chat-grouping";
