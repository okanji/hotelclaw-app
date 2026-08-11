import { createClient } from "@/lib/supabase/server";
import { channelHref } from "@/lib/chat/channel-href";
import { ChatIndexRedirect } from "@/components/chat/chat-index-redirect";

export default async function ChatIndex({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_channels")
    .select("stream_channel_id")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (data && data.length > 0) {
    // Client-side replace, NOT a server redirect() — see ChatIndexRedirect's
    // docblock for the hard-load crash this avoids.
    return (
      <ChatIndexRedirect
        href={channelHref(propertyId, "team", data[0].stream_channel_id)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <h2 className="text-lg font-semibold">No channels yet</h2>
      <p className="text-sm text-muted-foreground">
        Create your first channel from the sidebar to start chatting.
      </p>
    </div>
  );
}
