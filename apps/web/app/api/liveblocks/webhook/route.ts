import { NextResponse, type NextRequest } from "next/server";
import { WebhookHandler } from "@liveblocks/node";
import {
  captureDocumentSnapshot,
  persistDocumentSnapshot,
} from "@/lib/documents/snapshot";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { parseDocumentRoomId } from "@/lib/liveblocks/rooms";
import {
  captureSheetSnapshot,
  persistSheetSnapshot,
} from "@/lib/spreadsheet/snapshot";
import { createServiceClient } from "@/lib/supabase/server";
import { getCommentBot } from "@/lib/ai/bot-scaffold";

// Comment-bot generation (Anthropic Sonnet + tools + Liveblocks REST post-back)
// can take several seconds — lift the default 10s function ceiling so the bot
// has headroom. See node_modules/ai/docs/06-advanced/10-vercel-deployment-guide.mdx.
export const maxDuration = 60;

/**
 * Liveblocks webhook receiver.
 *
 * Today we handle three events:
 *
 *   • `ydocUpdated` — a Yjs doc in a room changed (Liveblocks coalesces
 *     these to one event per room per 60s; configurable to 5s on Enterprise).
 *     For our document rooms (`property:<pid>:doc:<did>`) we capture a
 *     snapshot — a Yjs binary update plus the Tiptap-rendered text and JSON —
 *     and write it back to the matching `documents` row. This makes
 *     Postgres the durable source of truth: Liveblocks remains the
 *     live-edit layer but is now replaceable (the binary update can be
 *     replayed into any Yjs provider).
 *
 *   • `storageUpdated` — Liveblocks Storage in a room changed (same ~60s
 *     coalesce window). Sheet docs (`kind = 'sheet'`) use Storage instead of
 *     Yjs, so this event drives `sheet_state` + `sheet_text` snapshots.
 *     Doc rooms also emit `storageUpdated` when Comments touch their
 *     internal storage; we filter by document kind so those are ignored.
 *
 *   • `roomDeleted` — if a Liveblocks admin or our `deletePropertyRooms`
 *     tears down a doc room, mark the matching row archived so the UI
 *     stops linking to it. We don't hard-delete: the room id encodes the
 *     document id and the data model preserves thread context tied to it
 *     (see migration 0009's "no DELETE policy" comment).
 *
 * Other events (comments, presence) are ignored — they're not part of the
 * persistence story. A future stage will hand off comment events to the
 * Vercel Chat SDK adapter for bot replies.
 *
 * Snapshot failures log and return 200. Returning 5xx triggers Liveblocks
 * retry, which is correct for transient errors but would loop forever on a
 * persistently malformed room — and the next edit (or a future cron
 * safety-net) reconciles cheaply. Signature failures DO return 401: that's
 * the only signal the dashboard surfaces meaningfully.
 *
 * Reference: https://liveblocks.io/docs/guides/can-i-use-my-own-database-with-yjs
 */
export async function POST(request: NextRequest) {
  const secret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[liveblocks-webhook] LIVEBLOCKS_WEBHOOK_SECRET not set");
    return NextResponse.json(
      { error: "LIVEBLOCKS_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  const handler = new WebhookHandler(secret);
  let event;
  try {
    event = handler.verifyRequest({ headers, rawBody });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid signature" },
      { status: 401 },
    );
  }

  if (event.type === "ydocUpdated") {
    const parsed = parseDocumentRoomId(event.data.roomId);
    // Task/board rooms also emit ydocUpdated (Liveblocks Comments use Yjs);
    // skip anything that isn't a `property:<pid>:doc:<did>` room.
    if (!parsed) return NextResponse.json({ ok: true, ignored: true });

    try {
      const liveblocks = getLiveblocksServer();
      const snapshot = await captureDocumentSnapshot(
        liveblocks,
        event.data.roomId,
      );
      const supabase = createServiceClient();
      const result = await persistDocumentSnapshot(
        supabase,
        parsed.documentId,
        snapshot,
      );
      if ("error" in result) {
        console.error(
          "[liveblocks-webhook] persistDocumentSnapshot failed",
          parsed.documentId,
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[liveblocks-webhook] snapshot capture failed",
        event.data.roomId,
        err,
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (event.type === "storageUpdated") {
    const parsed = parseDocumentRoomId(event.data.roomId);
    if (!parsed) return NextResponse.json({ ok: true, ignored: true });

    try {
      const supabase = createServiceClient();
      // Filter on `kind` here rather than letting the snapshot writer no-op:
      // we don't want to spend a REST round-trip into Liveblocks for every
      // doc room that emits storageUpdated for Comments storage.
      const { data: row, error } = await supabase
        .from("documents")
        .select("kind")
        .eq("id", parsed.documentId)
        .maybeSingle();
      if (error || !row || row.kind !== "sheet") {
        return NextResponse.json({ ok: true, ignored: true });
      }
      const liveblocks = getLiveblocksServer();
      const snapshot = await captureSheetSnapshot(
        liveblocks,
        event.data.roomId,
      );
      const result = await persistSheetSnapshot(
        supabase,
        parsed.documentId,
        snapshot,
      );
      if ("error" in result) {
        console.error(
          "[liveblocks-webhook] persistSheetSnapshot failed",
          parsed.documentId,
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[liveblocks-webhook] sheet snapshot capture failed",
        event.data.roomId,
        err,
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (event.type === "roomDeleted") {
    const parsed = parseDocumentRoomId(event.data.roomId);
    if (!parsed) return NextResponse.json({ ok: true, ignored: true });

    try {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("documents")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", parsed.documentId)
        .is("archived_at", null);
      if (error) {
        console.error(
          "[liveblocks-webhook] archive-on-roomDeleted failed",
          parsed.documentId,
          error.message,
        );
      }
    } catch (err) {
      console.error(
        "[liveblocks-webhook] archive-on-roomDeleted threw",
        event.data.roomId,
        err,
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Comment events (commentCreated, commentReactionAdded, commentReactionRemoved)
  // are routed to the Vercel Chat SDK bot via @liveblocks/chat-sdk-adapter.
  // The bot does its own signature verification, so we reconstruct a fresh
  // Request from the raw body and headers and hand it off.
  if (
    event.type === "commentCreated" ||
    event.type === "commentReactionAdded" ||
    event.type === "commentReactionRemoved"
  ) {
    try {
      const bot = getCommentBot();
      const forwarded = new Request(request.url, {
        method: "POST",
        headers,
        body: rawBody,
      });
      return await bot.webhooks.liveblocks(forwarded, {
        waitUntil: (p) => void p,
      });
    } catch (err) {
      // Don't 5xx — the comment was already created in Liveblocks; the bot
      // failing to reply shouldn't make Liveblocks retry forever.
      console.error(
        "[liveblocks-webhook] comment bot dispatch failed",
        event.type,
        err,
      );
      return NextResponse.json({ ok: true, botFailed: true });
    }
  }

  return new NextResponse(null, { status: 204 });
}
