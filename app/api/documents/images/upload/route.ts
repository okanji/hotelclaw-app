import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Image upload endpoint for the Tiptap Image extension.
 *
 *   POST /api/documents/images/upload?propertyId=<uuid>&documentId=<uuid>
 *   Body: multipart/form-data, field "file"
 *
 * Stores the file in the `documents-images` Supabase Storage bucket under
 * `{property_id}/{document_id}/{uuid}.{ext}` and returns `{ url, path }`.
 *
 * Auth: caller must be a member of `propertyId` (`is_member` RPC). RLS on
 * the storage bucket enforces the same constraint at the storage layer — this
 * route is defense-in-depth and also lets us reject early with a friendly
 * error before the upload bytes are streamed.
 */

const BUCKET = "documents-images";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
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
      { error: `Unsupported type: ${file.type}` },
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
  return NextResponse.json({ url: pub.publicUrl, path });
}
