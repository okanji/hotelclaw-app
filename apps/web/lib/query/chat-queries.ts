import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// React Query option factories for chat-level settings. The channel-creation
// policy gates the "New channel" affordance in the chat sidebar; the
// ChannelSettingsDialog invalidates it after a change.

export type ChannelCreationPolicy = "everyone" | "management";

export function channelCreationQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["channel-creation-policy", propertyId] as const,
    queryFn: async (): Promise<ChannelCreationPolicy> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("properties")
        .select("channel_creation")
        .eq("id", propertyId)
        .maybeSingle();
      return (data?.channel_creation as ChannelCreationPolicy) ?? "everyone";
    },
    staleTime: 5 * 60_000,
  });
}
