import "server-only";
/**
 * Document → knowledge-brain mirror (gbrain ingestion doctrine: app-authored
 * content is an external stream that must be INGESTED into the brain, not a
 * parallel silo — see the knowledge-architecture plan). 100% deterministic:
 * no model anywhere in this path, links built from ids in code.
 *
 * Postgres stays canonical; the brain page `documents/<id>` is a derived
 * mirror, overwritten wholesale on every sync (put_page chunks + embeds
 * server-side). Archive → delete_page (soft-delete on the serve).
 *
 * Triggers: the Liveblocks snapshot webhook (edit-driven, coalesced ~60s
 * upstream) and the nightly reconciliation cron /api/brain/sync-documents.
 * Cursor: documents.brain_synced_at (migration 0088).
 */
import {
  callBrain,
  documentBrainSlug,
  renderDocumentBrainPage,
  DOC_SYNC_INGESTED_VIA,
} from "@hotelclaw/brain";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { logBrainEvent } from "@/lib/brain/telemetry";
import { createServiceClient } from "@/lib/supabase/server";

type SyncOutcome =
  | { ok: true; action: "mirrored" | "deleted" | "skipped" }
  | { ok: false; reason: string };

/** Mirror one document into its property's brain (or remove it, when
 * archived). Fail-soft: every failure returns { ok:false } and logs. */
export async function syncDocumentToBrain(
  documentId: string,
): Promise<SyncOutcome> {
  const supabase = createServiceClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .select(
      "id, property_id, title, body_text, sheet_text, attachments_text, body_updated_at, archived_at",
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) {
    const reason = error?.message ?? "document not found";
    logBrainEvent("doc_sync_failed", { documentId, reason });
    return { ok: false, reason };
  }

  const binding = await resolvePropertyBrain(doc.property_id);
  if (!binding) {
    logBrainEvent("doc_sync_skipped_no_binding", {
      documentId,
      propertyId: doc.property_id,
    });
    return { ok: true, action: "skipped" };
  }

  const slug = documentBrainSlug(doc.id);

  if (doc.archived_at) {
    const deleted = await callBrain(binding.url, binding, "delete_page", {
      slug,
    });
    // A page that never existed deletes as an error on some serves — treat
    // "not found"-shaped failures as success (the mirror is absent either way).
    const ok =
      deleted.ok || /not.?found|does not exist|no such/i.test(deleted.reason);
    if (!ok) {
      logBrainEvent("doc_sync_failed", {
        documentId,
        propertyId: doc.property_id,
        stage: "delete",
        reason: deleted.reason,
      });
      return { ok: false, reason: deleted.reason };
    }
    await supabase
      .from("documents")
      .update({ brain_synced_at: new Date().toISOString() })
      .eq("id", doc.id);
    logBrainEvent("doc_sync_ok", { documentId, action: "deleted" });
    return { ok: true, action: "deleted" };
  }

  // Sheets keep their searchable text in sheet_text; regular docs in
  // body_text. Extracted attachment text (0089) rides along after the body
  // so PDF SOPs are findable in the brain too.
  const mainText =
    (doc.body_text as string | null)?.trim() ||
    (doc.sheet_text as string | null)?.trim() ||
    "";
  const attachmentsText = (doc.attachments_text as string | null)?.trim() ?? "";
  const bodyText = attachmentsText
    ? `${mainText}\n\n## Attached files (extracted text)\n\n${attachmentsText}`
    : mainText;

  const put = await callBrain(binding.url, binding, "put_page", {
    slug,
    content: renderDocumentBrainPage({
      title: doc.title,
      href: `/p/${doc.property_id}/documents/${doc.id}`,
      bodyText,
      updatedAt: doc.body_updated_at,
    }),
    ingested_via: DOC_SYNC_INGESTED_VIA,
  });
  if (!put.ok) {
    logBrainEvent("doc_sync_failed", {
      documentId,
      propertyId: doc.property_id,
      stage: "put",
      reason: put.reason,
    });
    return { ok: false, reason: put.reason };
  }
  await supabase
    .from("documents")
    .update({ brain_synced_at: new Date().toISOString() })
    .eq("id", doc.id);
  logBrainEvent("doc_sync_ok", { documentId, action: "mirrored" });
  return { ok: true, action: "mirrored" };
}

/** Reconciliation sweep across all properties: mirror anything whose
 * content or archive state drifted past the cursor. Bounded per run —
 * the nightly cron catches up over successive runs if a backlog forms. */
export async function sweepDocumentsBrainSync({
  limit = 200,
}: { limit?: number } = {}): Promise<{
  scanned: number;
  mirrored: number;
  deleted: number;
  skipped: number;
  failed: number;
}> {
  const supabase = createServiceClient();
  // Two staleness shapes (cursor null / cursor behind); PostgREST can't
  // compare two columns in a filter, so over-fetch candidates and compare
  // in code. Candidate set: never-synced docs + docs touched in the last
  // 14 days (the webhook path keeps steady state small; the first backfill
  // run uses --all via the script instead).
  const { data: rows, error } = await supabase
    .from("documents")
    .select("id, body_updated_at, archived_at, brain_synced_at")
    .order("brain_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3);
  if (error || !rows) {
    logBrainEvent("doc_sync_failed", { stage: "sweep", reason: error?.message });
    return { scanned: 0, mirrored: 0, deleted: 0, skipped: 0, failed: 0 };
  }

  const stale = rows
    .filter((d) => {
      const synced = d.brain_synced_at ? Date.parse(d.brain_synced_at) : null;
      if (d.archived_at) {
        return synced === null
          ? false // never mirrored and already archived — nothing to remove
          : Date.parse(d.archived_at) > synced;
      }
      if (synced === null) return true;
      return d.body_updated_at ? Date.parse(d.body_updated_at) > synced : false;
    })
    .slice(0, limit);

  const counts = { scanned: stale.length, mirrored: 0, deleted: 0, skipped: 0, failed: 0 };
  for (const doc of stale) {
    const outcome = await syncDocumentToBrain(doc.id);
    if (!outcome.ok) counts.failed += 1;
    else if (outcome.action === "mirrored") counts.mirrored += 1;
    else if (outcome.action === "deleted") counts.deleted += 1;
    else counts.skipped += 1;
  }
  return counts;
}
