import "server-only";
import { getStreamServer } from "@/lib/stream/server";
import { getBotUserId } from "@/lib/stream/ai-adapter";
import type { RunnerImpl } from "./types";

// Stream Chat channel IDs in workflows are the internal channel id (not the
// public Stream id). The runner looks them up if needed; callers can pass
// either the UUID from chat_channels or the stream_channel_id directly.

type PostMessageConfig = { channel_id: string; text: string };

export const postMessageRunner: RunnerImpl<
  PostMessageConfig,
  { message: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message: {
        id: `dry-${ctx.stepId}`,
        text: config.text,
        channel_id: config.channel_id,
      },
    };
  }
  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const res = await channel.sendMessage(
    {
      text: config.text,
      user_id: botId,
      ai_generated: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0],
  );
  return { message: res.message as unknown as Record<string, unknown> };
};

type PostThreadReplyConfig = {
  channel_id: string;
  parent_id: string;
  text: string;
};

export const postThreadReplyRunner: RunnerImpl<
  PostThreadReplyConfig,
  { message: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message: {
        id: `dry-${ctx.stepId}`,
        text: config.text,
        parent_id: config.parent_id,
      },
    };
  }
  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const res = await channel.sendMessage(
    {
      text: config.text,
      parent_id: config.parent_id,
      user_id: botId,
      ai_generated: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0],
  );
  return { message: res.message as unknown as Record<string, unknown> };
};

type MentionUserConfig = {
  channel_id: string;
  user_id: string;
  text: string;
};

export const mentionUserRunner: RunnerImpl<
  MentionUserConfig,
  { message: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message: {
        id: `dry-${ctx.stepId}`,
        text: config.text,
        mentioned_users: [config.user_id],
      },
    };
  }
  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const res = await channel.sendMessage(
    {
      text: config.text,
      mentioned_users: [config.user_id],
      user_id: botId,
      ai_generated: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0],
  );
  return { message: res.message as unknown as Record<string, unknown> };
};
