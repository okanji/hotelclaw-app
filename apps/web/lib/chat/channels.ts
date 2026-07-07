import type { SupabaseClient } from "@supabase/supabase-js";

export type PropertyChannel = {
  id: string;
  name: string;
  streamChannelId: string;
};

/** Active team channels for a property (newest first by name). */
export async function getPropertyChannels(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<PropertyChannel[]> {
  const { data, error } = await supabase
    .from("chat_channels")
    .select("id, name, stream_channel_id")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    streamChannelId: row.stream_channel_id,
  }));
}
