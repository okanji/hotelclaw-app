"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { parseFormSchema, inputFields } from "@/lib/forms/schema";

type ActionError = { error: string };

const Uuid = z.string().uuid();

/**
 * The custom Stream attachment a shared form travels as. The chat renderer
 * (components/chat/slack-attachment.tsx → FormAttachmentCard) and the
 * workflow `action.form.send` runner both emit this exact shape.
 */
export type FormAttachmentPayload = {
  type: "form";
  form_id: string;
  property_id: string;
  title: string;
  description?: string;
  field_count: number;
};

const ShareSchema = z.object({
  formId: Uuid,
  channelId: Uuid, // chat_channels row id
  note: z.string().max(500).optional(),
});

/**
 * Post a form into a chat channel as the current user — a "form" attachment
 * the channel renders as a fill-in-place card.
 */
export async function shareFormToChat(input: {
  formId: string;
  channelId: string;
  note?: string;
}): Promise<{ ok: true } | ActionError> {
  const parsed = ShareSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // RLS scopes both lookups to properties the user belongs to.
  const [{ data: form }, { data: channel }] = await Promise.all([
    supabase
      .from("forms")
      .select("id, property_id, title, description, schema, status")
      .eq("id", parsed.data.formId)
      .maybeSingle(),
    supabase
      .from("chat_channels")
      .select("id, property_id, stream_channel_id, name")
      .eq("id", parsed.data.channelId)
      .is("archived_at", null)
      .maybeSingle(),
  ]);
  if (!form) return { error: "Form not found" };
  if (!channel) return { error: "Channel not found" };
  if (form.property_id !== channel.property_id) return { error: "Channel not found" };
  if (form.status !== "published") {
    return { error: "Publish the form before sharing it" };
  }

  const attachment: FormAttachmentPayload = {
    type: "form",
    form_id: form.id,
    property_id: form.property_id,
    title: form.title,
    description: form.description ?? undefined,
    field_count: inputFields(parseFormSchema(form.schema)).length,
  };

  try {
    const stream = getStreamServer();
    await stream
      .channel("team", channel.stream_channel_id)
      .sendMessage({
        text: parsed.data.note?.trim() || "",
        user_id: user.id,
        attachments: [attachment],
      });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to post to chat" };
  }

  return { ok: true };
}

/**
 * Pin a form on a space's overview, next to pinned documents. Shares the
 * 8-pin budget with docs (the count below spans both kinds).
 */
export async function pinFormToSpace(
  spaceId: string,
  formId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const fid = Uuid.safeParse(formId);
  if (!sid.success || !fid.success) return { error: "Invalid id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const [{ data: space }, { data: form }] = await Promise.all([
    supabase.from("spaces").select("id, property_id").eq("id", sid.data).maybeSingle(),
    supabase.from("forms").select("id, property_id").eq("id", fid.data).maybeSingle(),
  ]);
  if (!space) return { error: "Team not found" };
  if (!form || form.property_id !== space.property_id) return { error: "Form not found" };

  const { count } = await supabase
    .from("space_pinned_resources")
    .select("*", { count: "exact", head: true })
    .eq("space_id", sid.data);
  if ((count ?? 0) >= 8) return { error: "You can pin up to 8 resources" };

  const { data: existing } = await supabase
    .from("space_pinned_resources")
    .select("id")
    .eq("space_id", sid.data)
    .eq("form_id", fid.data)
    .maybeSingle();
  if (existing) return { ok: true };

  const { data: top } = await supabase
    .from("space_pinned_resources")
    .select("position")
    .eq("space_id", sid.data)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("space_pinned_resources").insert({
    space_id: sid.data,
    form_id: fid.data,
    position: (top?.position ?? 0) + 1024,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unpinFormFromSpace(
  spaceId: string,
  formId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const fid = Uuid.safeParse(formId);
  if (!sid.success || !fid.success) return { error: "Invalid id" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("space_pinned_resources")
    .delete()
    .eq("space_id", sid.data)
    .eq("form_id", fid.data);
  if (error) return { error: error.message };
  return { ok: true };
}
