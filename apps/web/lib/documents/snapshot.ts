import "server-only";
import { withProsemirrorDocument } from "@liveblocks/node-prosemirror";
import { READ_SCHEMA } from "@/lib/documents/editor-schema";
import type { Liveblocks } from "@liveblocks/node";
import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Snapshot of a document's body at a point in time. Lossless — `bodyState` is
 * a Yjs binary update that can be replayed into any Yjs-compatible provider
 * via `Y.applyUpdate(new Y.Doc(), bytes)` or pushed back into Liveblocks via
 * `liveblocks.sendYjsBinaryUpdate(roomId, bytes)`.
 *
 * `bodyText` and `bodyJson` are derived views — useful for search, AI prompts,
 * SSR, exports — but `bodyState` is the source of truth.
 */
export type DocumentSnapshot = {
  bodyState: Uint8Array;
  bodyText: string;
  bodyJson: unknown;
};

/**
 * Fetch the latest Yjs state for a room and the Tiptap-rendered text/JSON.
 * Two REST calls to Liveblocks (one for the raw binary, one wrapped in
 * `withProsemirrorDocument` for the prosemirror conversion). Acceptable: the
 * webhook is throttled to 60s per room so the call site isn't a hot path.
 *
 * Throws on any fetch error. Callers (webhook handler, backfill script)
 * should catch and log — a failed snapshot must not 500 the webhook (that
 * would retry forever) and must not abort the backfill loop.
 */
export async function captureDocumentSnapshot(
  liveblocks: Liveblocks,
  roomId: string,
): Promise<DocumentSnapshot> {
  const [bodyStateBuf, derived] = await Promise.all([
    liveblocks.getYjsDocumentAsBinaryUpdate(roomId),
    // READ_SCHEMA, not the library default. Omitting the schema here parsed
    // every document with Liveblocks' StarterKit-only default, silently
    // dropping tables, callouts, toggles, charts, embeds, attachments,
    // images and task lists from body_text/body_json while leaving them
    // intact in Yjs — so that content was unsearchable, absent from the
    // brain mirror, and invisible to the AI's read-before-edit (which then
    // destroyed it on the next mode=replace). See lib/documents/editor-schema.ts.
    withProsemirrorDocument<{ bodyText: string; bodyJson: unknown }>(
      { client: liveblocks, roomId, schema: READ_SCHEMA },
      (api) => ({
        bodyText: api.getText({ blockSeparator: "\n" }),
        bodyJson: api.toJSON(),
      }),
    ),
  ]);
  return {
    bodyState: new Uint8Array(bodyStateBuf),
    bodyText: derived.bodyText,
    bodyJson: derived.bodyJson,
  };
}

/**
 * Write a snapshot to the `documents` row. Service-role client expected — the
 * webhook runs without a user session, and the backfill script needs to
 * bypass RLS to reach rows across every property.
 *
 * `body_state` is a `bytea` column; supabase-js accepts a Node `Buffer`,
 * which `Uint8Array` wraps cleanly. `body_updated_at` is set server-side so
 * a future safety-net cron can find rows where `updated_at` ran ahead of it
 * (missed webhook delivery).
 */
export async function persistDocumentSnapshot(
  supabase: ServiceClient,
  documentId: string,
  snapshot: DocumentSnapshot,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("documents")
    .update({
      // supabase-js encodes Uint8Array as `\x…` hex literal for the bytea
      // column. Buffer.from is a no-copy wrapper around the same backing
      // memory — used so the network payload stays a recognized Node Buffer.
      body_state: Buffer.from(snapshot.bodyState),
      body_text: snapshot.bodyText,
      body_json: snapshot.bodyJson,
      body_updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  if (error) return { error: error.message };
  return { ok: true };
}
