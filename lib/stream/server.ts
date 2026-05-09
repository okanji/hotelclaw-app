import "server-only";
import { StreamChat } from "stream-chat";

let _client: StreamChat | null = null;

export function getStreamServer() {
  if (_client) return _client;
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("Missing NEXT_PUBLIC_STREAM_API_KEY or STREAM_API_SECRET");
  }
  _client = StreamChat.getInstance(apiKey, apiSecret, { timeout: 15000 });
  return _client;
}

// Cache successful upserts for the lifetime of the server process so we don't
// hit Stream on every token request.
const _upsertedUsers = new Set<string>();

export async function upsertStreamUser(user: {
  id: string;
  name?: string | null;
  image?: string | null;
}) {
  const stream = getStreamServer();
  const cacheKey = `${user.id}|${user.name ?? ""}|${user.image ?? ""}`;
  if (_upsertedUsers.has(cacheKey)) return;
  await stream.upsertUser({
    id: user.id,
    name: user.name ?? user.id,
    image: user.image ?? undefined,
  });
  _upsertedUsers.add(cacheKey);
}

export function createStreamUserToken(userId: string) {
  return getStreamServer().createToken(userId);
}

export async function createPropertyChannel(args: {
  propertyId: string;
  channelId: string;
  name: string;
  createdBy: string;
  memberIds: string[];
  isPrivate?: boolean;
}) {
  const stream = getStreamServer();
  const channel = stream.channel("team", args.channelId, {
    name: args.name,
    members: args.memberIds,
    created_by_id: args.createdBy,
    property_id: args.propertyId,
    is_private: args.isPrivate ?? false,
  } as Record<string, unknown>);
  await channel.create();
  return channel;
}
