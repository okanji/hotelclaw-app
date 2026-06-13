import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { getBotUserId } from "@/lib/stream/ai-adapter";
import { inputFields, parseFormSchema } from "@/lib/forms/schema";
import type { RunnerImpl } from "./types";

// Posts a form into a chat channel as a `form` attachment so staff can fill
// it right from chat. Template values in config are resolved by the runtime
// before the runner is called (same as the chat runners). Channel ids follow
// the chat-runner convention: either the chat_channels UUID or the public
// stream_channel_id works.

const DEFAULT_MESSAGE = "Please fill out this form";

type FormSendConfig = {
  form_id: string;
  channel_id: string;
  message?: string;
};

export const formSendRunner: RunnerImpl<
  FormSendConfig,
  { message_id: string; channel_id: string; form_id: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message_id: `dry-${ctx.stepId}`,
      channel_id: config.channel_id,
      form_id: config.form_id,
    };
  }

  const supabase = createServiceClient();
  const { data: form } = await supabase
    .from("forms")
    .select("id, title, description, schema, status")
    .eq("id", config.form_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!form || form.status !== "published") {
    throw new Error("Form not found or not published");
  }

  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const res = await channel.sendMessage(
    {
      text: config.message?.trim() || DEFAULT_MESSAGE,
      user_id: botId,
      ai_generated: true,
      attachments: [
        {
          type: "form",
          form_id: form.id,
          property_id: ctx.propertyId,
          title: form.title,
          description: form.description ?? undefined,
          field_count: inputFields(parseFormSchema(form.schema)).length,
        },
      ],
    } as unknown as Parameters<typeof channel.sendMessage>[0],
  );
  const message = res.message as unknown as { id?: string };
  return {
    message_id: String(message?.id ?? ""),
    channel_id: config.channel_id,
    form_id: form.id,
  };
};
