import "server-only";
import { StreamClient } from "@stream-io/node-sdk";

let _client: StreamClient | null = null;

/**
 * Lazy singleton for server-side Stream Video operations. Same API key +
 * secret as the Chat SDK — Stream's Chat and Video products run off the same
 * app credentials. Used by the /api/stream/video-token route.
 */
export function getStreamVideoServer(): StreamClient {
  if (_client) return _client;
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("Missing NEXT_PUBLIC_STREAM_API_KEY or STREAM_API_SECRET");
  }
  _client = new StreamClient(apiKey, apiSecret);
  return _client;
}
