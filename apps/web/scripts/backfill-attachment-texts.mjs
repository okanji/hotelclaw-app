// Backfill text extraction for files already sitting in the documents-files
// bucket (migration 0089). Idempotent: rows are keyed by storage_path and
// existing ones are skipped. Run from apps/web:
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/backfill-attachment-texts.mjs
//
// After it finishes, run the doc→brain sweep (or wait for the nightly cron)
// so the refreshed attachments_text reaches the brain mirrors:
//   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/brain/sync-documents
import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

const BUCKET = "documents-files";
const TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
]);
const MIME_BY_EXT = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
};
const PER_FILE_CAP = 200_000;
const AGGREGATE_CAP = 400_000;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function listAll(prefix) {
  const out = [];
  let page = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 100, offset: page * 100 });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 100) return out;
    page += 1;
  }
}

async function extract(mime, buffer) {
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
    console.error("  extraction failed:", err.message);
  }
  return "";
}

const { data: existingRows } = await supabase
  .from("document_attachment_texts")
  .select("storage_path");
const existing = new Set((existingRows ?? []).map((r) => r.storage_path));

const touchedDocs = new Set();
let scanned = 0;
let extracted = 0;

// Bucket layout: {property_id}/{document_id}/{uuid}.{ext}
for (const propertyDir of await listAll("")) {
  if (!propertyDir.id && !propertyDir.name) continue;
  for (const docDir of await listAll(propertyDir.name)) {
    const prefix = `${propertyDir.name}/${docDir.name}`;
    for (const file of await listAll(prefix)) {
      const path = `${prefix}/${file.name}`;
      scanned += 1;
      if (existing.has(path)) continue;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mime =
        file.metadata?.mimetype ?? MIME_BY_EXT[ext ?? ""] ?? "application/octet-stream";
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(path);
      if (dlErr) {
        console.error("download failed", path, dlErr.message);
        continue;
      }
      const text = await extract(mime, await blob.arrayBuffer());
      const { error: insErr } = await supabase
        .from("document_attachment_texts")
        .upsert(
          {
            property_id: propertyDir.name,
            document_id: docDir.name,
            storage_path: path,
            file_name: file.name,
            mime,
            text_content: text,
            extracted_at: new Date().toISOString(),
          },
          { onConflict: "storage_path" },
        );
      if (insErr) {
        console.error("upsert failed", path, insErr.message);
        continue;
      }
      if (text) {
        extracted += 1;
        touchedDocs.add(docDir.name);
      }
      console.log(`${text ? "extracted" : "stored-empty"} ${path} (${text.length} chars)`);
    }
  }
}

// Rebuild aggregates for touched docs (same shape as
// lib/documents/attachment-text.ts:rebuildDocumentAttachmentsText).
for (const documentId of touchedDocs) {
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

console.log(
  `done: scanned ${scanned}, newly extracted ${extracted}, docs updated ${touchedDocs.size}`,
);
