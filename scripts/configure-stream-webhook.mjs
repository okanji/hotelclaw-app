#!/usr/bin/env node
/**
 * Register (or update) the Stream Chat webhook that fans message.new events
 * out to /api/stream/webhook/message-new. Run once after reserving a domain,
 * and again only if the origin changes (new reserved domain, prod cutover,
 * etc.). With a reserved ngrok domain the URL is stable across restarts, so
 * day-to-day development does not need to re-run this.
 *
 * Usage:
 *   node --env-file=.env.local scripts/configure-stream-webhook.mjs \
 *     https://<your-host>
 *
 * The script appends the route path automatically; pass only the origin.
 */

import { StreamChat } from "stream-chat";

const origin = process.argv[2];
if (!origin) {
  console.error(
    "usage: node --env-file=.env.local scripts/configure-stream-webhook.mjs <https-origin>",
  );
  process.exit(1);
}
if (!origin.startsWith("https://")) {
  console.error("origin must start with https://");
  process.exit(1);
}

const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
const secret = process.env.STREAM_API_SECRET;
if (!apiKey || !secret) {
  console.error(
    "Missing NEXT_PUBLIC_STREAM_API_KEY / STREAM_API_SECRET. Did you run with --env-file=.env.local?",
  );
  process.exit(1);
}

const webhookUrl = `${origin.replace(/\/$/, "")}/api/stream/webhook/message-new`;

const client = StreamChat.getInstance(apiKey, secret);

// Stream's v2 hook system: configure via the `event_hooks` array on the app.
// `explicit_event_hooks_deletion: true` makes the update replace the entire
// hook list with the array provided here — exactly one hook for this URL —
// instead of appending. That's what we want, so re-running the script after a
// ngrok URL change cleanly swaps the URL instead of leaving dead hooks behind.
const res = await client.updateAppSettings({
  event_hooks: [
    {
      hook_type: "webhook",
      enabled: true,
      product: "chat",
      event_types: ["message.new"],
      webhook_url: webhookUrl,
    },
  ],
  explicit_event_hooks_deletion: true,
});

console.log(`Webhook registered: ${webhookUrl}`);
console.log(`Stream response duration: ${res.duration ?? "n/a"}`);
