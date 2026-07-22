import "server-only";
/**
 * Text extraction for document file attachments (migration 0089). Closes
 * the class-C knowledge silo: uploaded PDFs/text files were stored but
 * never indexed — invisible to search_documents, the brain mirror, and
 * every bot.
 *
 * Coverage is deliberately conservative: PDFs (via unpdf — serverless
 * pdf.js build, no native deps) and plain-text formats. Office formats
 * (docx/xlsx/pptx), audio and video stay unextracted for now — they land
 * in the table with empty text so the backfill doesn't retry them forever.
 *
 * Flow: extract → upsert document_attachment_texts (idempotent on
 * storage_path) → rebuild documents.attachments_text (drives body_fts
 * weight C) → re-mirror the doc into the brain.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { createServiceClient } from "@/lib/supabase/server";
import { syncDocumentToBrain } from "@/lib/brain/doc-sync";

const TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
]);

const PER_FILE_CAP = 200_000;
const AGGREGATE_CAP = 400_000;

/** Extract plaintext, or "" for stored-but-unsupported types. */
export async function extractAttachmentText(
  mime: string,
  buffer: ArrayBuffer,
): Promise<string> {
  try {
    if (mime === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.trim().slice(0, PER_FILE_CAP);
    }
    if (TEXT_MIMES.has(mime)) {
      return new TextDecoder("utf-8", { fatal: false })
        .decode(buffer)
        .trim()
        .slice(0, PER_FILE_CAP);
    }
  } catch (err) {
    console.error("[attachment-text] extraction failed", mime, err);
  }
  return "";
}

/** Rebuild the per-document aggregate that body_fts indexes. */
export async function rebuildDocumentAttachmentsText(
  documentId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: rows } = await supabase
    .from("document_attachment_texts")
    .select("file_name, text_content")
    .eq("document_id", documentId)
    .order("extracted_at", { ascending: true });
  const aggregate = (rows ?? [])
    .filter((r) => r.text_content)
    .map((r) => `--- ${r.file_name} ---\n${r.text_content}`)
    .join("\n\n")
    .slice(0, AGGREGATE_CAP);
  await supabase
    .from("documents")
    .update({ attachments_text: aggregate })
    .eq("id", documentId);
}

/**
 * Extract + persist one uploaded file's text and refresh the document's
 * search/brain surfaces. Fail-soft; callers run it via after().
 */
export async function ingestAttachmentText(input: {
  propertyId: string;
  documentId: string;
  storagePath: string;
  fileName: string;
  mime: string;
  buffer: ArrayBuffer;
}): Promise<void> {
  const text = await extractAttachmentText(input.mime, input.buffer);
  const supabase = createServiceClient();
  const { error } = await supabase.from("document_attachment_texts").upsert(
    {
      property_id: input.propertyId,
      document_id: input.documentId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime: input.mime,
      text_content: text,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: "storage_path" },
  );
  if (error) {
    console.error("[attachment-text] upsert failed", input.storagePath, error.message);
    return;
  }
  if (text) {
    await rebuildDocumentAttachmentsText(input.documentId);
    await syncDocumentToBrain(input.documentId);
  }
}
