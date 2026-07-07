#!/usr/bin/env node
/**
 * Register (or update) the Stream Chat webhook that fans message.new events
 * out to /api/stream/webhook/message-new.
 *
 * IMPORTANT: Stream has ONE app-level message.new hook shared by dev and prod.
 * Pointing it at a dev ngrok tunnel silences the PROD bot (and a dead tunnel
 * silences both — this has bitten us). Flip to `dev` for a local session and
 * back to `prod` when you're done.
 *
 * Usage:
 *   node --env-file=.env.local scripts/configure-stream-webhook.mjs dev
 *     → resolves the current ngrok tunnel (127.0.0.1:4040) and points the hook at it
 *   node --env-file=.env.local scripts/configure-stream-webhook.mjs prod
 *     → points the hook at PROD_APP_URL (default https://hotelclaw-app.vercel.app)
 *   node --env-file=.env.local scripts/configure-stream-webhook.mjs status
 *     → prints the currently configured hooks
 *   node --env-file=.env.local scripts/configure-stream-webhook.mjs https://<host>
 *     → points the hook at an explicit origin
 *
 * The script appends the route path automatically; pass only the origin.
 */

import { StreamChat } from "stream-chat";

const PROD_ORIGIN = process.env.PROD_APP_URL ?? "https://hotelclaw-app.vercel.app";

const arg = process.argv[2];
if (!arg) {
  console.error(
    "usage: node --env-file=.env.local scripts/configure-stream-webhook.mjs <dev|prod|status|https-origin>",
  );
  process.exit(1);
}

let origin = arg;
if (arg === "prod") {
  origin = PROD_ORIGIN;
} else if (arg === "dev") {
  try {
    const tunnels = (
      await (await fetch("http://127.0.0.1:4040/api/tunnels")).json()
    ).tunnels;
    origin = tunnels?.[0]?.public_url;
    if (!origin) throw new Error("no tunnels");
  } catch {
    console.error(
      "Could not resolve an ngrok tunnel from http://127.0.0.1:4040 — is ngrok running? (ngrok http 3000)",
    );
    process.exit(1);
  }
} else if (arg !== "status" && !arg.startsWith("https://")) {
  console.error("origin must start with https:// (or use dev|prod|status)");
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

const client = StreamChat.getInstance(apiKey, secret);

if (arg === "status") {
  const app = (await client.getAppSettings()).app;
  const hooks = app.event_hooks ?? [];
  if (!hooks.length) console.log("No event hooks configured.");
  for (const h of hooks) {
    console.log(
      `${h.hook_type ?? "webhook"} | ${(h.event_types ?? []).join(",")} → ${
        h.webhook_url ?? h.sqs_url ?? "?"
      } | enabled: ${h.enabled !== false}`,
    );
  }
  process.exit(0);
}

const webhookUrl = `${origin.replace(/\/$/, "")}/api/stream/webhook/message-new`;

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
