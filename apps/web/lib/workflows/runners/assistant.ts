import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { eveOrigin, fleetServiceHeaders } from "@/lib/fleet/eve-session";
import type { RunnerImpl } from "./types";

/**
 * `action.assistant.run` — run the personal assistant on a brief and file the
 * result as a real conversation.
 *
 * WHY THIS EXISTS rather than reusing `action.external.delegate_to_openclaw`:
 * delegation starts a headless eve session and records it in
 * `channel_bot_sessions`, where no human surface shows it. The point of a
 * scheduled brief is that it lands somewhere you already look, carrying the
 * project's instructions/memory/context, and that you can REPLY to it. That
 * means creating an `assistant_chats` row and pointing it at the session — at
 * which point the Assistant surface renders the run for free, because a
 * conversation's transcript IS its eve session's event log.
 *
 * The step STARTS the turn and returns; it does not wait for it. An eve turn
 * is durable and routinely runs for minutes, so blocking a workflow step on it
 * would trade a reliable design for a timeout. Completion is announced by the
 * assistant itself (`send_notification`, appended to the brief when `notify`
 * is set) — the only actor that knows when the work is actually done.
 */

type AssistantRunConfig = {
  brief: string;
  project_id?: string;
  title?: string;
  notify?: boolean;
};

type AssistantRunOutput = {
  started: boolean;
  chat_id?: string;
  session_id?: string;
  skipped_reason?: string;
  error?: string;
};

/** Titles are shown in a tab strip — keep them short enough to read there. */
const MAX_TITLE = 120;

export const assistantRunRunner: RunnerImpl<
  AssistantRunConfig,
  AssistantRunOutput
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { started: true, skipped_reason: "dry run" };

  const brief = (config.brief ?? "").trim();
  if (!brief) return { started: false, error: "No brief was configured." };

  // The run acts as the workflow's OWNER — the person who set the schedule up.
  // Assistant rows are personal, so without an owner there is nobody to file
  // the conversation under and the step cannot proceed.
  const userId = ctx.workflowOwnerId;
  if (!userId) {
    return { started: false, error: "This workflow has no owner to run as." };
  }

  const service = createServiceClient();

  // A project that was archived or deleted since the schedule was created
  // must not silently produce unfiled conversations forever — no-op instead,
  // visibly, in the run log.
  let projectId: string | null = null;
  let projectName: string | null = null;
  if (config.project_id) {
    const { data: project } = await service
      .from("assistant_projects")
      .select("id, name, archived_at, property_id, user_id")
      .eq("id", config.project_id)
      .maybeSingle();
    if (
      !project ||
      project.archived_at ||
      project.property_id !== ctx.propertyId ||
      project.user_id !== userId
    ) {
      return {
        started: false,
        skipped_reason:
          "The assistant project this schedule points at is archived, deleted, or not the workflow owner's.",
      };
    }
    projectId = project.id;
    projectName = project.name;
  }

  const title =
    (config.title ?? "").trim().slice(0, MAX_TITLE) ||
    (projectName ? `${projectName} — scheduled run` : "Scheduled run");

  const { data: chat, error: chatError } = await service
    .from("assistant_chats")
    .insert({
      property_id: ctx.propertyId,
      user_id: userId,
      project_id: projectId,
      title,
      source: "scheduled",
      workflow_id: ctx.workflowId,
    })
    .select("id")
    .single();
  if (chatError || !chat) {
    return { started: false, error: chatError?.message ?? "Could not open a conversation." };
  }

  // The now-line is not decoration: without it the model resolves "this week"
  // against its training data (a channel-bot probe once scheduled a meeting a
  // year in the past). A scheduled brief is ALL relative dates, so it matters
  // more here than anywhere else.
  const deepLink = `/p/${ctx.propertyId}/assistant?c=${chat.id}`;
  const message = [
    `[Now: ${new Date().toISOString()} (UTC)]`,
    "",
    "[This is a SCHEDULED run — nobody is waiting on the other end right now. Do the work end to end, then write the finished brief as your reply. The person will read it later in this conversation and may reply to continue, so leave them something they can act on rather than questions they have to answer before anything is useful. If a fact is genuinely missing, say what is missing and what you did anyway — never park and wait.]",
    config.notify
      ? `[When you have finished, call send_notification to tell the requester the brief is ready, with a one-line headline and this link: ${deepLink}]`
      : "",
    "",
    brief,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(`${eveOrigin()}/eve/v1/session`, {
      method: "POST",
      headers: fleetServiceHeaders({
        propertyId: ctx.propertyId,
        userId,
        botSlug: "assistant",
        ...(projectId ? { projectId } : {}),
      }),
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      // Leave the chat row: an empty conversation titled after the schedule is
      // a visible failure, which beats a silent one.
      return {
        started: false,
        chat_id: chat.id,
        error: `Assistant runtime returned ${response.status}.`,
      };
    }
    const body = (await response.json()) as {
      sessionId?: string;
      continuationToken?: string;
    };
    if (!body.sessionId) {
      return { started: false, chat_id: chat.id, error: "No session id returned." };
    }

    await service
      .from("assistant_chats")
      .update({
        eve_session_id: body.sessionId,
        continuation_token: body.continuationToken ?? null,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", chat.id);

    return { started: true, chat_id: chat.id, session_id: body.sessionId };
  } catch (e) {
    return {
      started: false,
      chat_id: chat.id,
      error: e instanceof Error ? e.message : "Assistant runtime unreachable.",
    };
  }
};
