import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { registerTaskAttachment } from "@/components/tasks/task-detail-actions";

const BUCKET = "task-attachments";
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Defense in depth: don't rely solely on RLS for upload authorization.
  // If the tasks RLS policy ever regresses, the storage upload would still
  // happen before the registerTaskAttachment insert fails.
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("property_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || task.property_id !== propertyId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  }

  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${propertyId}/${taskId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const result = await registerTaskAttachment({
    taskId,
    fileName: file.name,
    storagePath: path,
    mimeType: file.type || null,
    byteSize: file.size,
  });
  if ("error" in result) {
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  return NextResponse.json({
    attachmentId: result.attachmentId,
    url: signed?.signedUrl ?? "",
  });
}
