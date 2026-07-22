import "server-only";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type TaskDetailMeta = {
  subIssues: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
  }>;
  links: Array<{ id: string; url: string; title: string | null }>;
  relatedTasks: Array<{
    id: string;
    title: string;
    status: string;
    relationId: string;
    relation: "related" | "blocks" | "blocked_by";
  }>;
  labels: string[];
  projectName: string | null;
  favorited: boolean;
  muted: boolean;
  reminders: Array<{ id: string; remindAt: string }>;
  documents: Array<{ id: string; documentId: string; title: string }>;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string | null;
    byteSize: number | null;
    url: string;
  }>;
  descriptionRevisions: Array<{
    id: string;
    description: string | null;
    createdAt: string;
  }>;
};

export async function getTaskDetailMeta(
  supabase: ServerClient,
  taskId: string,
  userId: string,
): Promise<TaskDetailMeta | null> {
  const { data: task } = await supabase
    .from("tasks")
    .select("id, labels, project_name")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;

  const [
    subIssuesRes,
    linksRes,
    relationsOutRes,
    relationsInRes,
    favoriteRes,
    muteRes,
    remindersRes,
    documentsRes,
    attachmentsRes,
    revisionsRes,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, priority")
      .eq("parent_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_links")
      .select("id, url, title")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_relations")
      .select("id, related_task_id, kind")
      .eq("task_id", taskId),
    supabase
      .from("task_relations")
      .select("id, task_id, kind")
      .eq("related_task_id", taskId),
    supabase
      .from("task_favorites")
      .select("task_id")
      .eq("user_id", userId)
      .eq("task_id", taskId)
      .maybeSingle(),
    supabase
      .from("task_notification_mutes")
      .select("task_id")
      .eq("user_id", userId)
      .eq("task_id", taskId)
      .maybeSingle(),
    supabase
      .from("task_reminders")
      .select("id, remind_at")
      .eq("task_id", taskId)
      .eq("user_id", userId)
      .gte("remind_at", new Date().toISOString())
      .order("remind_at", { ascending: true }),
    supabase
      .from("task_document_links")
      .select("id, document_id")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_attachments")
      .select("id, file_name, storage_path, mime_type, byte_size")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_description_revisions")
      .select("id, description, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Direction decides the label: an outgoing 'blocks' row means this task
  // BLOCKS the other; an incoming one means this task is BLOCKED BY it.
  const relatedIds = new Map<
    string,
    { relationId: string; relation: "related" | "blocks" | "blocked_by" }
  >();
  for (const r of relationsOutRes.data ?? []) {
    relatedIds.set(r.related_task_id, {
      relationId: r.id,
      relation: r.kind === "blocks" ? "blocks" : "related",
    });
  }
  for (const r of relationsInRes.data ?? []) {
    if (!relatedIds.has(r.task_id)) {
      relatedIds.set(r.task_id, {
        relationId: r.id,
        relation: r.kind === "blocks" ? "blocked_by" : "related",
      });
    }
  }

  let relatedTasks: TaskDetailMeta["relatedTasks"] = [];
  if (relatedIds.size > 0) {
    const { data: relatedRows } = await supabase
      .from("tasks")
      .select("id, title, status")
      .in("id", [...relatedIds.keys()]);
    relatedTasks = (relatedRows ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      relationId: relatedIds.get(t.id)!.relationId,
      relation: relatedIds.get(t.id)!.relation,
    }));
  }

  const documentIds = (documentsRes.data ?? []).map((d) => d.document_id);
  let documentTitles = new Map<string, string>();
  if (documentIds.length > 0) {
    const { data: docRows } = await supabase
      .from("documents")
      .select("id, title")
      .in("id", documentIds);
    documentTitles = new Map((docRows ?? []).map((d) => [d.id, d.title]));
  }

  const attachments = await Promise.all(
    (attachmentsRes.data ?? []).map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("task-attachments")
        .createSignedUrl(a.storage_path, 3600);
      return {
        id: a.id,
        fileName: a.file_name,
        mimeType: a.mime_type,
        byteSize: a.byte_size,
        url: signed?.signedUrl ?? "",
      };
    }),
  );

  return {
    subIssues: subIssuesRes.data ?? [],
    links: linksRes.data ?? [],
    relatedTasks,
    labels: task.labels ?? [],
    projectName: task.project_name,
    favorited: !!favoriteRes.data,
    muted: !!muteRes.data,
    reminders: (remindersRes.data ?? []).map((r) => ({
      id: r.id,
      remindAt: r.remind_at,
    })),
    documents: (documentsRes.data ?? []).map((d) => ({
      id: d.id,
      documentId: d.document_id,
      title: documentTitles.get(d.document_id) ?? "Document",
    })),
    attachments,
    descriptionRevisions: (revisionsRes.data ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      createdAt: r.created_at,
    })),
  };
}
