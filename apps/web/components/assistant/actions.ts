"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TEXT_RESOURCE_MAX } from "@/lib/assistant/types";

/**
 * Server actions for the Assistant section.
 *
 * All writes go through the USER's RLS client on purpose — unlike the fleet
 * and org-chart surfaces there is no role gate to enforce and no cross-user
 * row to touch, so the 0102 policies (`user_id = auth.uid()`) are the whole
 * authorization story. Writing these through the service client would be
 * strictly more dangerous for zero benefit.
 */

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Title = z.string().trim().min(1).max(200);

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── Chats ──────────────────────────────────────────────────────────────────

export async function createChat(input: {
  propertyId: string;
  projectId?: string | null;
  title?: string;
}): Promise<{ chatId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  if (!pid.success) return { error: "Invalid property" };
  const projectId = input.projectId ? Uuid.safeParse(input.projectId) : null;
  if (projectId && !projectId.success) return { error: "Invalid project" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("assistant_chats")
    .insert({
      property_id: pid.data,
      user_id: user.id,
      project_id: projectId?.success ? projectId.data : null,
      title: input.title?.trim().slice(0, 200) || "New chat",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not start a chat" };
  return { chatId: data.id };
}

/**
 * Record the eve session behind a chat. Called after every turn: the first
 * turn mints the session id and a title from the opening message, and each
 * follow-up refreshes the continuation token (a stale token cannot resume).
 */
export async function recordChatTurn(input: {
  chatId: string;
  eveSessionId: string;
  continuationToken: string | null;
  title?: string;
}): Promise<{ ok: true } | ActionError> {
  const chatId = Uuid.safeParse(input.chatId);
  if (!chatId.success) return { error: "Invalid chat" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const patch: {
    eve_session_id: string;
    continuation_token: string | null;
    last_message_at: string;
    title?: string;
  } = {
    eve_session_id: input.eveSessionId,
    continuation_token: input.continuationToken,
    last_message_at: new Date().toISOString(),
  };
  // Titles are set once, from the opening message — a later turn renaming the
  // conversation out from under an open tab is disorienting.
  if (input.title) patch.title = input.title.trim().slice(0, 200);

  const { error } = await supabase
    .from("assistant_chats")
    .update(patch)
    .eq("id", chatId.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function renameChat(input: {
  chatId: string;
  title: string;
}): Promise<{ ok: true } | ActionError> {
  const chatId = Uuid.safeParse(input.chatId);
  const title = Title.safeParse(input.title);
  if (!chatId.success) return { error: "Invalid chat" };
  if (!title.success) return { error: "A title is required" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("assistant_chats")
    .update({ title: title.data })
    .eq("id", chatId.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setChatPinned(input: {
  chatId: string;
  pinned: boolean;
}): Promise<{ ok: true } | ActionError> {
  const chatId = Uuid.safeParse(input.chatId);
  if (!chatId.success) return { error: "Invalid chat" };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("assistant_chats")
    .update({ pinned: input.pinned })
    .eq("id", chatId.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function moveChatToProject(input: {
  chatId: string;
  projectId: string | null;
}): Promise<{ ok: true } | ActionError> {
  const chatId = Uuid.safeParse(input.chatId);
  if (!chatId.success) return { error: "Invalid chat" };
  const projectId = input.projectId ? Uuid.safeParse(input.projectId) : null;
  if (projectId && !projectId.success) return { error: "Invalid project" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("assistant_chats")
    .update({ project_id: projectId?.success ? projectId.data : null })
    .eq("id", chatId.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Archive rather than delete. The eve session outlives the row either way,
 * and a soft delete means "close this tab" and "lose this conversation" stay
 * two different gestures.
 */
export async function archiveChat(input: {
  chatId: string;
}): Promise<{ ok: true } | ActionError> {
  const chatId = Uuid.safeParse(input.chatId);
  if (!chatId.success) return { error: "Invalid chat" };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("assistant_chats")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", chatId.data);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Projects ───────────────────────────────────────────────────────────────

const ProjectPatch = z.object({
  name: Title.optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  instructions: z.string().trim().max(20_000).nullable().optional(),
  memory: z.string().trim().max(20_000).nullable().optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  tint: z.string().trim().max(24).optional(),
  pinned: z.boolean().optional(),
});

export async function createProject(input: {
  propertyId: string;
  name: string;
  description?: string;
  emoji?: string;
  tint?: string;
}): Promise<{ projectId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const name = Title.safeParse(input.name);
  if (!pid.success) return { error: "Invalid property" };
  if (!name.success) return { error: "A project name is required" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("assistant_projects")
    .insert({
      property_id: pid.data,
      user_id: user.id,
      name: name.data,
      description: input.description?.trim() || null,
      ...(input.emoji ? { emoji: input.emoji } : {}),
      ...(input.tint ? { tint: input.tint } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the project" };

  revalidatePath(`/p/${pid.data}/assistant/projects`);
  return { projectId: data.id };
}

export async function updateProject(input: {
  projectId: string;
  propertyId: string;
  patch: z.infer<typeof ProjectPatch>;
}): Promise<{ ok: true } | ActionError> {
  const projectId = Uuid.safeParse(input.projectId);
  const patch = ProjectPatch.safeParse(input.patch);
  if (!projectId.success) return { error: "Invalid project" };
  if (!patch.success) return { error: "Invalid change" };

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("assistant_projects")
    .update(patch.data)
    .eq("id", projectId.data);
  if (error) return { error: error.message };

  revalidatePath(`/p/${input.propertyId}/assistant/projects/${projectId.data}`);
  return { ok: true };
}

export async function archiveProject(input: {
  projectId: string;
  propertyId: string;
}): Promise<{ ok: true } | ActionError> {
  const projectId = Uuid.safeParse(input.projectId);
  if (!projectId.success) return { error: "Invalid project" };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("assistant_projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${input.propertyId}/assistant/projects`);
  return { ok: true };
}

// ── Project context ────────────────────────────────────────────────────────

export async function addProjectResource(input: {
  projectId: string;
  propertyId: string;
  kind: "document" | "text";
  documentId?: string;
  title: string;
  body?: string;
}): Promise<{ ok: true } | ActionError> {
  const projectId = Uuid.safeParse(input.projectId);
  const pid = Uuid.safeParse(input.propertyId);
  const title = Title.safeParse(input.title);
  if (!projectId.success || !pid.success) return { error: "Invalid project" };
  if (!title.success) return { error: "A title is required" };

  if (input.kind === "document") {
    const docId = Uuid.safeParse(input.documentId ?? "");
    if (!docId.success) return { error: "Pick a document" };
  } else if (!input.body?.trim()) {
    return { error: "Paste some text first" };
  }

  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("assistant_project_resources").insert({
    project_id: projectId.data,
    property_id: pid.data,
    user_id: user.id,
    kind: input.kind,
    document_id: input.kind === "document" ? input.documentId : null,
    title: title.data,
    body:
      input.kind === "text" ? input.body!.trim().slice(0, TEXT_RESOURCE_MAX) : null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/p/${pid.data}/assistant/projects/${projectId.data}`);
  return { ok: true };
}

export async function removeProjectResource(input: {
  resourceId: string;
}): Promise<{ ok: true } | ActionError> {
  const resourceId = Uuid.safeParse(input.resourceId);
  if (!resourceId.success) return { error: "Invalid item" };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("assistant_project_resources")
    .delete()
    .eq("id", resourceId.data);
  if (error) return { error: error.message };
  return { ok: true };
}
