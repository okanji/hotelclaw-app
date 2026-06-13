import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Upload endpoint for the form "Attachment" field type.
 *
 *   POST /api/properties/:propertyId/forms/:formId/upload
 *   Body: multipart/form-data, field "file"
 *
 * Stores into the `form-uploads` bucket (migration 0059) under
 * `{property_id}/{form_id}/{uuid}.{ext}` and returns
 * `{ url, path, name, size, type }` — the shape the renderer keeps in the
 * answer value. Mirrors `/api/documents/files/upload` with a
 * photo-centric allowlist and a 25 MB ceiling.
 */

const BUCKET = "form-uploads";
const MAX_BYTES = 25 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; formId: string }> },
) {
  const { propertyId, formId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!form) {
    return NextResponse.json({ error: "form not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  if (!EXT_BY_MIME[file.type]) {
    return NextResponse.json(
      { error: `Unsupported type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  const path = `${propertyId}/${formId}/${crypto.randomUUID()}.${EXT_BY_MIME[file.type]}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    url: pub.publicUrl,
    path,
    name: file.name,
    size: file.size,
    type: file.type,
  });
}
