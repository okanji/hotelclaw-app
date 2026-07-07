/**
 * The route for a Stream chat channel.
 *
 * DMs (`messaging`) live under `/dms/<id>`, team channels under `/chat/<id>`,
 * so the two are never confusable by URL — a route prefix alone tells them
 * apart. Pass the Stream channel `type`; anything other than `"messaging"`
 * is treated as a team channel.
 *
 * This is the single chokepoint for building channel URLs — every link,
 * redirect, and deep link should go through it rather than hand-assembling
 * the path.
 */
export function channelHref(
  propertyId: string,
  channelType: string | undefined,
  channelId: string,
  opts?: { messageId?: string },
): string {
  const base = channelType === "messaging" ? "dms" : "chat";
  const query = opts?.messageId
    ? `?messageId=${encodeURIComponent(opts.messageId)}`
    : "";
  return `/p/${propertyId}/${base}/${channelId}${query}`;
}
