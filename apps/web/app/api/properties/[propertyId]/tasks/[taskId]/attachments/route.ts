import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPropertyAccess } from "@/lib/auth/session";
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
  // Guests (0118) may attach to a task they hold an EDIT grant on; the
  // storage + task_attachments policies enforce the grant, this is the
  // early refusal.
  const membership = await getPropertyAccess(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (membership.role === "guest") {
    const { data: canEdit } = await supabase.rpc("can_access_task", {
      tid: taskId,
      need_edit: true,
    });
    if (canEdit !== true) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("property_id, space_id, list_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || task.property_id !== propertyId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // `?field=<id>` files the upload into a named file slot (0116 "files"
  // field — Quote, LPO, GRN). The DB derives the field's value from it.
  const fieldId = request.nextUrl.searchParams.get("field");
  if (fieldId) {
    const { data: field } = await supabase
      .from("custom_fields")
      .select("type, space_id, list_id")
      .eq("id", fieldId)
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .maybeSingle();
    if (!field || field.type !== "files") {
      return NextResponse.json({ error: "Not a files field" }, { status: 400 });
    }
    if (
      (field.space_id && field.space_id !== task.space_id) ||
      (field.list_id && field.list_id !== task.list_id)
    ) {
      return NextResponse.json(
        { error: "That field belongs to a different team or list" },
        { status: 400 },
      );
    }
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
    fieldId,
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
