#!/usr/bin/env node
/**
 * One-shot backfill: walk every active `documents` row whose `body_state` is
 * NULL and write the current Liveblocks Yjs state into it. Run once after
 * the 0018 migration deploys so existing docs aren't stuck on the
 * `body_snippet → body_text` best-effort copy from the migration itself.
 *
 * Idempotent. Re-running re-snapshots already-written rows (so it's also
 * usable as a recovery tool if a slice of webhooks ever gets dropped). Pass
 * `--missing-only` to skip rows that already have a snapshot.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-document-snapshots.mjs
 *   node --env-file=.env.local scripts/backfill-document-snapshots.mjs --missing-only
 *
 * Requires LIVEBLOCKS_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY in the env (see .env.local.example).
 */

import { Liveblocks } from "@liveblocks/node";
import { withProsemirrorDocument } from "@liveblocks/node-prosemirror";
import { createClient } from "@supabase/supabase-js";
// The SAME schema the app parses documents with. Without it Liveblocks falls
// back to its StarterKit-only default and this backfill would re-write every
// row's body_text/body_json with tables, callouts, charts, embeds,
// attachments, images and task lists stripped out — which is precisely the
// bug this script is now used to REPAIR (2026-08-11).
import { READ_SCHEMA } from "../lib/documents/editor-schema.ts";

const PAGE_SIZE = 100;
const missingOnly = process.argv.includes("--missing-only");

const liveblocksSecret = process.env.LIVEBLOCKS_SECRET_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!liveblocksSecret || !supabaseUrl || !supabaseServiceKey) {
  console.error(
    "missing env: LIVEBLOCKS_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const liveblocks = new Liveblocks({ secret: liveblocksSecret });
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

/**
 * Fetch one page of active documents. Pagination via `id` cursor — `updated_at`
 * isn't a stable sort key while a backfill is racing with live edits.
 */
async function fetchPage(afterId) {
  let q = supabase
    .from("documents")
    .select("id, property_id, body_state")
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (afterId) q = q.gt("id", afterId);
  const { data, error } = await q;
  if (error) throw new Error(`fetchPage failed: ${error.message}`);
  return data ?? [];
}

let cursor = null;
let stats = { scanned: 0, snapshotted: 0, skipped: 0, failed: 0 };

for (;;) {
  const page = await fetchPage(cursor);
  if (page.length === 0) break;
  cursor = page[page.length - 1].id;

  for (const row of page) {
    stats.scanned += 1;
    if (missingOnly && row.body_state) {
      stats.skipped += 1;
      continue;
    }

    const roomId = `property:${row.property_id}:doc:${row.id}`;
    try {
      const [bodyStateBuf, derived] = await Promise.all([
        liveblocks.getYjsDocumentAsBinaryUpdate(roomId),
        withProsemirrorDocument({ client: liveblocks, roomId, schema: READ_SCHEMA }, (api) => ({
          bodyText: api.getText({ blockSeparator: "\n" }),
          bodyJson: api.toJSON(),
        })),
      ]);

      const { error } = await supabase
        .from("documents")
        .update({
          body_state: Buffer.from(new Uint8Array(bodyStateBuf)),
          body_text: derived.bodyText,
          body_json: derived.bodyJson,
          body_updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);

      stats.snapshotted += 1;
      console.log(`✓ ${row.id} (${derived.bodyText.length} chars)`);
    } catch (err) {
      stats.failed += 1;
      // Most common failure: the room has never been opened — Liveblocks
      // returns a 404. Safe to skip; the snapshot will land the first time
      // someone opens the doc and triggers the webhook.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`✗ ${row.id}: ${msg}`);
    }
  }
}

console.log("done", stats);
