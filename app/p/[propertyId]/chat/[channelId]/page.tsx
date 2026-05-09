import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChannelView } from "@/components/chat/channel-view";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ propertyId: string; channelId: string }>;
}) {
  const { propertyId, channelId } = await params;
  const supabase = await createClient();
  const { data: channel } = await supabase
    .from("chat_channels")
    .select("id, name, stream_channel_id, stream_channel_type")
    .eq("property_id", propertyId)
    .eq("stream_channel_id", channelId)
    .maybeSingle();

  if (!channel) notFound();

  return (
    <ChannelView
      channelId={channel.stream_channel_id}
      channelType={channel.stream_channel_type}
      channelName={channel.name}
    />
  );
}
