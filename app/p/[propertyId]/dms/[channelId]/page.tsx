import { ChannelView } from "@/components/chat/channel-view";

/**
 * Direct-message route — DM (`messaging`) conversations.
 *
 * Mirrors the team-channel route at `/chat/[channelId]`, but DMs get their
 * own `/dms/*` prefix so a conversation is never confusable with a channel
 * by URL. `ChannelView` is type-agnostic — it renders whatever channel the
 * sidebar <ChannelList> has already watched — so the two routes share it.
 *
 * Like the chat route, this does NO per-navigation data fetching: the RSC
 * payload stays trivial and fully prefetchable, which keeps switching
 * conversations instant.
 */
export default async function DmChannelPage({
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
