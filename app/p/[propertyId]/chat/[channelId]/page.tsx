import { ChannelView } from "@/components/chat/channel-view";

/**
 * Channel route — handles both `team` channels and `messaging` DMs.
 *
 * Channel metadata (name, type, members, messages) is resolved entirely
 * client-side: ChannelView reuses the channel the sidebar <ChannelList> has
 * already watched. This page therefore does NO per-navigation data fetching,
 * which keeps its RSC payload trivial and fully prefetchable — that's what
 * makes switching channels feel instant (Slack-style).
 */
export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string; channelId: string }>;
  searchParams: Promise<{ messageId?: string | string[] }>;
}) {
  const { propertyId, channelId } = await params;
  const sp = await searchParams;
  const messageIdRaw = sp.messageId;
  const messageId = Array.isArray(messageIdRaw) ? messageIdRaw[0] : messageIdRaw;

  return (
    <ChannelView
      channelId={channelId}
      propertyId={propertyId}
      messageId={messageId ?? null}
    />
  );
}
