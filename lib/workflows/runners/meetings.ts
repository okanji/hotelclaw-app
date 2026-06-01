import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { getBotUserId } from "@/lib/stream/ai-adapter";
import { createTaskRunner } from "./tasks";
import type { RunnerImpl } from "./types";

type ActionItem = { text: string; owner: string | null };

type CreateFollowupTasksConfig = {
  meeting_id: string;
  assignee_id?: string;
};

export const createFollowupTasksRunner: RunnerImpl<
  CreateFollowupTasksConfig,
  { created_count: number; task_ids: string[] }
> = async ({ config, ctx }) => {
  const supabase = createServiceClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title")
    .eq("id", config.meeting_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!meeting) throw new Error("create_followup_tasks: meeting not found");

  const { data: summaryRow } = await supabase
    .from("meeting_summaries")
    .select("action_items")
    .eq("meeting_id", config.meeting_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const actionItems = (summaryRow?.action_items ?? []) as ActionItem[];
  if (actionItems.length === 0) {
    return { created_count: 0, task_ids: [] };
  }

  const taskIds: string[] = [];
  for (const item of actionItems) {
    const { task } = await createTaskRunner({
      config: {
        title: item.text,
        description: `Follow-up from meeting: ${meeting.title}`,
        assignee_id: config.assignee_id,
        labels: ["meeting-follow-up"],
      },
      ctx,
    });
    taskIds.push(String(task.id));
  }

  return { created_count: taskIds.length, task_ids: taskIds };
};

type ShareSummaryConfig = { meeting_id: string; channel_id: string };

export const shareSummaryToChannelRunner: RunnerImpl<
  ShareSummaryConfig,
  { message: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message: {
        id: `dry-${ctx.stepId}`,
        channel_id: config.channel_id,
      },
    };
  }

  const supabase = createServiceClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, property_id, stream_call_id")
    .eq("id", config.meeting_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!meeting) throw new Error("share_summary_to_channel: meeting not found");

  const { data: summaryRow } = await supabase
    .from("meeting_summaries")
    .select("summary_md, action_items")
    .eq("meeting_id", config.meeting_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!summaryRow?.summary_md) {
    throw new Error("share_summary_to_channel: meeting summary not ready yet");
  }

  const actionItems = (summaryRow.action_items ?? []) as ActionItem[];
  const actionBlock =
    actionItems.length > 0
      ? `\n\n**Action items**\n${actionItems
          .map((a) => `- ${a.text}${a.owner ? ` — ${a.owner}` : ""}`)
          .join("\n")}`
      : "";

  const notesLink = `\n\n[📑 Open full notes](/p/${ctx.propertyId}/meetings/${meeting.id})`;
  const text =
    `📝 **Meeting summary: ${meeting.title}**\n\n` +
    summaryRow.summary_md +
    actionBlock +
    notesLink;

  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const res = await channel.sendMessage(
    {
      text,
      user_id: botId,
      ai_generated: true,
      meeting_id: meeting.id,
      meeting_call_id: meeting.stream_call_id,
      is_meeting_summary: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0],
    { skip_push: true },
  );
  return { message: res.message as unknown as Record<string, unknown> };
};
