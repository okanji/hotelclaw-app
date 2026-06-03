import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Non-image file upload endpoint for the FileAttachment / PDF block.
 *
 *   POST /api/documents/files/upload?propertyId=<uuid>&documentId=<uuid>
 *   Body: multipart/form-data, field "file"
 *
 * Stores into the `documents-files` Supabase Storage bucket under
 * `{property_id}/{document_id}/{uuid}.{ext}` and returns
 * `{ url, path, name, size, type }`.
 *
 * Auth: caller must be a member of `propertyId` (`is_member` RPC). RLS on
 * the storage bucket enforces the same constraint — this route is
 * defense-in-depth and gives a clean error before bytes are streamed.
 *
 * Mirrors `/api/documents/images/upload/route.ts` (bucket = `documents-images`,
 * 10MB) with a broader MIME allowlist and a 50MB ceiling.
 */

const BUCKET = "documents-files";
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED = new Set([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Plain
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  // Audio
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

// Map MIME → extension for the storage path. Falls back to `bin` for
// anything we somehow allow but don't have a mapping for.
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!propertyId || !documentId) {
    return NextResponse.json(
      { error: "propertyId and documentId required" },
      { status: 400 },
    );
  }

  const { data: isMember, error: memberErr } = await supabase.rpc("is_member", {
    prop_id: propertyId,
  });
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${propertyId}/${documentId}/${crypto.randomUUID()}.${ext}`;

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
