"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { upsertLabel } from "@/components/labels/actions";

const Uuid = z.string().uuid();

const LinkSchema = z.object({
  taskId: Uuid,
  url: z.string().url().max(2000),
  title: z.string().max(200).optional(),
});

const RelationSchema = z.object({
  taskId: Uuid,
  relatedTaskId: Uuid,
  /** 'blocked_by' is sugar — stored as a reversed 'blocks' row. */
  kind: z.enum(["related", "blocks", "blocked_by"]).default("related"),
});

const LabelSchema = z.object({
  taskId: Uuid,
  label: z.string().min(1).max(40),
});

const ProjectSchema = z.object({
  taskId: Uuid,
  projectName: z.string().max(120).nullable(),
});

const DocumentLinkSchema = z.object({
  taskId: Uuid,
  documentId: Uuid,
});

const ReminderSchema = z.object({
  taskId: Uuid,
  remindAt: z.string().datetime(),
});

async function taskPropertyId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
) {
  const { data } = await supabase
    .from("tasks")
    .select("property_id")
    .eq("id", taskId)
    .maybeSingle();
  return data?.property_id ?? null;
}

function revalidateTask(propertyId: string, taskId: string) {
  revalidatePath(`/p/${propertyId}/tasks`);
  revalidatePath(`/p/${propertyId}/tasks/${taskId}`);
}

export async function addTaskLink(
  input: z.input<typeof LinkSchema>,
): Promise<{ ok: true; linkId: string } | { error: string }> {
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid URL" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, parsed.data.taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data, error } = await supabase
    .from("task_links")
    .insert({
      task_id: parsed.data.taskId,
      url: parsed.data.url,
      title: parsed.data.title ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to add link" };
  revalidateTask(propertyId, parsed.data.taskId);
  return { ok: true, linkId: data.id };
}

export async function removeTaskLink(
  linkId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: link } = await supabase
    .from("task_links")
    .select("task_id")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { error: "Link not found" };

  const propertyId = await taskPropertyId(supabase, link.task_id);
  if (!propertyId) return { error: "Task not found" };

  const { error } = await supabase.from("task_links").delete().eq("id", linkId);
  if (error) return { error: error.message };
  revalidateTask(propertyId, link.task_id);
  return { ok: true };
}

export async function addTaskRelation(
  input: z.input<typeof RelationSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = RelationSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  if (parsed.data.taskId === parsed.data.relatedTaskId) {
    return { error: "A task cannot relate to itself" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, parsed.data.taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data: related } = await supabase
    .from("tasks")
    .select("property_id")
    .eq("id", parsed.data.relatedTaskId)
    .maybeSingle();
  if (!related || related.property_id !== propertyId) {
    return { error: "Related task not found" };
  }

  // "X is blocked by Y" is stored as "Y blocks X" — one canonical direction.
  const inverted = parsed.data.kind === "blocked_by";
  const { error } = await supabase.from("task_relations").insert({
    task_id: inverted ? parsed.data.relatedTaskId : parsed.data.taskId,
    related_task_id: inverted ? parsed.data.taskId : parsed.data.relatedTaskId,
    kind: parsed.data.kind === "related" ? "related" : "blocks",
    created_by: user.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "Already related" };
    return { error: error.message };
  }
  revalidateTask(propertyId, parsed.data.taskId);
  return { ok: true };
}

export async function removeTaskRelation(
  relationId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("task_relations")
    .select("task_id")
    .eq("id", relationId)
    .maybeSingle();
  if (!rel) return { error: "Relation not found" };

  const propertyId = await taskPropertyId(supabase, rel.task_id);
  if (!propertyId) return { error: "Task not found" };

  const { error } = await supabase
    .from("task_relations")
    .delete()
    .eq("id", relationId);
  if (error) return { error: error.message };
  revalidateTask(propertyId, rel.task_id);
  return { ok: true };
}

export async function addTaskLabel(
  input: z.input<typeof LabelSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = LabelSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid label" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: task } = await supabase
    .from("tasks")
    .select("property_id, labels")
    .eq("id", parsed.data.taskId)
    .maybeSingle();
  if (!task) return { error: "Task not found" };

  const label = parsed.data.label.trim();
  const labels = task.labels ?? [];
  if (labels.includes(label)) return { error: "Label already added" };

  const { error } = await supabase
    .from("tasks")
    .update({ labels: [...labels, label] })
    .eq("id", parsed.data.taskId);
  if (error) return { error: error.message };
  // Mirror into the shared catalog so the label carries a color and documents
  // can reuse it (the unified label system). Best-effort — task labels still
  // live in the array, which the workflow `task.label_added` trigger reads.
  await upsertLabel(supabase, task.property_id, label, user?.id ?? null);
  revalidateTask(task.property_id, parsed.data.taskId);
  return { ok: true };
}

export async function removeTaskLabel(
  taskId: string,
  label: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("property_id, labels")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return { error: "Task not found" };

  const { error } = await supabase
    .from("tasks")
    .update({ labels: (task.labels ?? []).filter((l) => l !== label) })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidateTask(task.property_id, taskId);
  return { ok: true };
}

export async function setTaskProject(
  input: z.input<typeof ProjectSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = ProjectSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const propertyId = await taskPropertyId(supabase, parsed.data.taskId);
  if (!propertyId) return { error: "Task not found" };

  const { error } = await supabase
    .from("tasks")
    .update({ project_name: parsed.data.projectName })
    .eq("id", parsed.data.taskId);
  if (error) return { error: error.message };
  revalidateTask(propertyId, parsed.data.taskId);
  return { ok: true };
}

export async function toggleTaskFavorite(
  taskId: string,
): Promise<{ ok: true; favorited: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data: existing } = await supabase
    .from("task_favorites")
    .select("task_id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("task_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("task_id", taskId);
    if (error) return { error: error.message };
    revalidateTask(propertyId, taskId);
    return { ok: true, favorited: false };
  }

  const { error } = await supabase.from("task_favorites").insert({
    user_id: user.id,
    task_id: taskId,
  });
  if (error) return { error: error.message };
  revalidateTask(propertyId, taskId);
  return { ok: true, favorited: true };
}

export async function toggleTaskMute(
  taskId: string,
): Promise<{ ok: true; muted: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data: existing } = await supabase
    .from("task_notification_mutes")
    .select("task_id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("task_notification_mutes")
      .delete()
      .eq("user_id", user.id)
      .eq("task_id", taskId);
    if (error) return { error: error.message };
    revalidateTask(propertyId, taskId);
    return { ok: true, muted: false };
  }

  const { error } = await supabase.from("task_notification_mutes").insert({
    user_id: user.id,
    task_id: taskId,
  });
  if (error) return { error: error.message };
  revalidateTask(propertyId, taskId);
  return { ok: true, muted: true };
}

export async function addTaskReminder(
  input: z.input<typeof ReminderSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = ReminderSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid reminder time" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, parsed.data.taskId);
  if (!propertyId) return { error: "Task not found" };

  const remindAt = Date.parse(parsed.data.remindAt);
  if (Number.isNaN(remindAt) || remindAt <= Date.now()) {
    return { error: "Reminder must be in the future" };
  }

  const { error } = await supabase.from("task_reminders").insert({
    task_id: parsed.data.taskId,
    user_id: user.id,
    remind_at: parsed.data.remindAt,
  });
  if (error) return { error: error.message };
  revalidateTask(propertyId, parsed.data.taskId);
  return { ok: true };
}

export async function linkTaskDocument(
  input: z.input<typeof DocumentLinkSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = DocumentLinkSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, parsed.data.taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data: doc } = await supabase
    .from("documents")
    .select("property_id")
    .eq("id", parsed.data.documentId)
    .maybeSingle();
  if (!doc || doc.property_id !== propertyId) {
    return { error: "Document not found" };
  }

  const { error } = await supabase.from("task_document_links").insert({
    task_id: parsed.data.taskId,
    document_id: parsed.data.documentId,
    created_by: user.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "Document already linked" };
    return { error: error.message };
  }
  revalidateTask(propertyId, parsed.data.taskId);
  return { ok: true };
}

export async function unlinkTaskDocument(
  linkId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: link } = await supabase
    .from("task_document_links")
    .select("task_id")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { error: "Link not found" };

  const propertyId = await taskPropertyId(supabase, link.task_id);
  if (!propertyId) return { error: "Task not found" };

  const { error } = await supabase
    .from("task_document_links")
    .delete()
    .eq("id", linkId);
  if (error) return { error: error.message };
  revalidateTask(propertyId, link.task_id);
  return { ok: true };
}

export async function removeTaskAttachment(
  attachmentId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("task_attachments")
    .select("task_id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { error: "Attachment not found" };

  const propertyId = await taskPropertyId(supabase, row.task_id);
  if (!propertyId) return { error: "Task not found" };

  await supabase.storage.from("task-attachments").remove([row.storage_path]);
  const { error } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) return { error: error.message };
  revalidateTask(propertyId, row.task_id);
  return { ok: true };
}

export async function registerTaskAttachment(args: {
  taskId: string;
  fileName: string;
  storagePath: string;
  mimeType: string | null;
  byteSize: number;
}): Promise<{ ok: true; attachmentId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const propertyId = await taskPropertyId(supabase, args.taskId);
  if (!propertyId) return { error: "Task not found" };

  const { data, error } = await supabase
    .from("task_attachments")
    .insert({
      task_id: args.taskId,
      file_name: args.fileName,
      storage_path: args.storagePath,
      mime_type: args.mimeType,
      byte_size: args.byteSize,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to save" };
  revalidateTask(propertyId, args.taskId);
  return { ok: true, attachmentId: data.id };
}
