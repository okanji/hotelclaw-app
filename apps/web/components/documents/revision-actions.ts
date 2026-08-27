"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  readDocumentBodyHtml,
  writeDocumentBody,
} from "@/lib/documents/write-body";
import { syncDocumentToBrain } from "@/lib/brain/doc-sync";

/**
 * Restore a pre-replace AI revision (document_ai_revisions, 0094) as the
 * document's live body. Mirrors the internal write route's recipe exactly:
 * revision body_json → faithful HTML (readDocumentBodyHtml) → replace via
 * writeDocumentBody — which STASHES THE CURRENT BODY FIRST, so a restore is
 * itself undoable — then the brain re-mirror in after().
 *
 * Auth: any member (the same people who can edit the document live).
 * Tenancy: propertyId is re-checked against the document inside both
 * write-body helpers; the revisionId is additionally verified to belong to
 * this document before anything runs.
 */
export async function restoreAiRevision(input: {
  propertyId: string;
  documentId: string;
  revisionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const membership = await getMembershipForProperty(input.propertyId);
  if (!membership) return { ok: false, error: "Not a member of this property." };

  // RLS client: proves the revision row is visible to this member AND
  // belongs to the claimed document/property before the service-side write.
  const { data: revision } = await supabase
    .from("document_ai_revisions")
    .select("id")
    .eq("id", input.revisionId)
    .eq("document_id", input.documentId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!revision) return { ok: false, error: "Revision not found." };

  const read = await readDocumentBodyHtml({
    propertyId: input.propertyId,
    documentId: input.documentId,
    revisionId: input.revisionId,
  });
  if (!read.ok) return { ok: false, error: read.error };

  const write = await writeDocumentBody({
    propertyId: input.propertyId,
    documentId: input.documentId,
    html: read.html,
    mode: "replace",
  });
  if (!write.ok) return { ok: false, error: write.error };

  after(() => syncDocumentToBrain(input.documentId).catch(() => {}));
  return { ok: true };
}
