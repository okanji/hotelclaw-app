import { Stack, useRouter } from "expo-router";
import { ChannelList } from "stream-chat-expo";
import type { ChannelFilters, ChannelOptions, ChannelSort } from "stream-chat";
import { chatUserId } from "../chatConfig";
import { useAppContext } from "../contexts/AppContext";

// hotelclaw's web app creates team channels as type "team" (see
// apps/web/lib/stream/server.ts), so match that here, not the tutorial's
// "messaging".
const filters: ChannelFilters = {
  members: { $in: [chatUserId] },
  type: "team",
};

const sort: ChannelSort = {
  last_message_at: -1,
};

const options: ChannelOptions = {
  limit: 20,
  presence: true,
  state: true,
  watch: true,
};

export default function ChannelListScreen() {
  const router = useRouter();
  const { setChannel } = useAppContext();

  return (
    <>
      <Stack.Screen options={{ title: "Channels" }} />
      <ChannelList
        filters={filters}
        options={options}
        sort={sort}
        onSelect={(channel) => {
          setChannel(channel);
          router.push({
            pathname: "/channel/[cid]",
            params: { cid: channel.cid },
          });
        }}
      />
    </>
  );
}
