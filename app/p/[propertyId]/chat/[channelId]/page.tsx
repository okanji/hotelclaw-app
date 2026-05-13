import { createClient } from "@/lib/supabase/server";
import { ChannelView } from "@/components/chat/channel-view";

/**
 * Channel route handles both `team` (mirrored in chat_channels for queries/AI)
 * and `messaging` (DMs — Stream-only, no DB row). For DMs we render with
 * channelType="messaging" and let the client resolve the channel from Stream.
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

  const supabase = await createClient();

  const { data: row } = await supabase
    .from("chat_channels")
    .select("name, stream_channel_id, stream_channel_type")
    .eq("property_id", propertyId)
    .eq("stream_channel_id", channelId)
    .is("archived_at", null)
    .maybeSingle();

  return (
    <ChannelView
      channelId={channelId}
      channelType={row?.stream_channel_type ?? "messaging"}
      channelName={row?.name ?? null}
      propertyId={propertyId}
      messageId={messageId ?? null}
    />
  );
}
