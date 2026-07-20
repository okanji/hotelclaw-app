"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  ChatbotConfigZod,
  CHATBOT_TEMPLATES,
  EMPTY_CHATBOT_CONFIG,
} from "@/lib/chatbots/schema";
import { templateDef } from "@/lib/chatbots/templates";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(120);

export async function createChatbot(input: {
  propertyId: string;
  name: string;
  template?: string;
  config?: unknown;
}): Promise<{ chatbotId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const name = Name.safeParse(input.name);
  if (!pid.success) return { error: "Invalid property" };
  if (!name.success) return { error: "Chatbot name is required" };

  const template = CHATBOT_TEMPLATES.includes(
    input.template as (typeof CHATBOT_TEMPLATES)[number],
  )
    ? (input.template as (typeof CHATBOT_TEMPLATES)[number])
    : "custom";

  // Explicit config (the AI-generate path) wins; else the template's
  // preset; else an empty custom bot.
  let config = EMPTY_CHATBOT_CONFIG;
  if (input.config) {
    const parsed = ChatbotConfigZod.safeParse(input.config);
    if (!parsed.success) return { error: "Invalid chatbot config" };
    config = parsed.data;
  } else {
    const def = templateDef(template);
    if (def) config = def.config;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("chatbots")
    .insert({
      property_id: pid.data,
      name: name.data,
      template,
      config,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to create chatbot" };

  revalidatePath(`/p/${pid.data}/chatbots`);
  return { chatbotId: data.id };
}

const UpdateSchema = z.object({
  chatbotId: Uuid,
  patch: z.object({
    name: Name.optional(),
    config: ChatbotConfigZod.optional(),
    status: z.enum(["draft", "published", "paused"]).optional(),
    daily_message_cap: z.number().int().min(10).max(10000).optional(),
    session_message_cap: z.number().int().min(5).max(200).optional(),
    allowed_domains: z
      .array(z.string().trim().min(1).max(200))
      .max(10)
      .optional(),
    twilio_number: z.string().trim().max(40).nullable().optional(),
    archived_at: z.string().nullable().optional(),
  }),
});

export async function updateChatbot(input: {
  chatbotId: string;
  patch: {
    name?: string;
    config?: unknown;
    status?: "draft" | "published" | "paused";
    daily_message_cap?: number;
    session_message_cap?: number;
    allowed_domains?: string[];
    twilio_number?: string | null;
    archived_at?: string | null;
  };
}): Promise<{ ok: true } | ActionError> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("chatbots")
    .update(parsed.data.patch)
    .eq("id", parsed.data.chatbotId)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Chatbot not found" };

  revalidatePath(`/p/${data.property_id}/chatbots`);
  return { ok: true };
}

export async function deleteChatbot(
  chatbotId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(chatbotId);
  if (!id.success) return { error: "Invalid chatbot" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("chatbots")
    .delete()
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Chatbot not found" };

  revalidatePath(`/p/${data.property_id}/chatbots`);
  return { ok: true };
}

/** Rotate the public slug — kills every previously shared link and QR code. */
export async function regenerateChatbotSlug(
  chatbotId: string,
): Promise<{ slug: string } | ActionError> {
  const id = Uuid.safeParse(chatbotId);
  if (!id.success) return { error: "Invalid chatbot" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // 32 hex chars of CSPRNG, matching the column default.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const slug = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await supabase
    .from("chatbots")
    .update({ public_slug: slug })
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Chatbot not found" };

  revalidatePath(`/p/${data.property_id}/chatbots`);
  return { slug };
}

// ---------------------------------------------------------------------------
// Knowledge sources
// ---------------------------------------------------------------------------

const SourceSchema = z
  .object({
    chatbotId: Uuid,
    propertyId: Uuid,
    kind: z.enum(["text", "qa", "document", "url"]),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(200_000).optional(),
    question: z.string().max(2000).optional(),
    documentId: Uuid.optional(),
    url: z.string().url().max(2000).optional(),
  })
  .refine(
    (s) =>
      (s.kind === "text" && !!s.content) ||
      (s.kind === "qa" && !!s.question && !!s.content) ||
      (s.kind === "document" && !!s.documentId) ||
      (s.kind === "url" && !!s.url),
    { message: "Missing source content" },
  );

export async function addKnowledgeSource(input: {
  chatbotId: string;
  propertyId: string;
  kind: "text" | "qa" | "document" | "url";
  title: string;
  content?: string;
  question?: string;
  documentId?: string;
  url?: string;
}): Promise<{ sourceId: string } | ActionError> {
  const parsed = SourceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid source" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const s = parsed.data;
  const { data, error } = await supabase
    .from("chatbot_knowledge_sources")
    .insert({
      chatbot_id: s.chatbotId,
      property_id: s.propertyId,
      kind: s.kind,
      title: s.title,
      content: s.content ?? null,
      question: s.question ?? null,
      document_id: s.documentId ?? null,
      url: s.url ?? null,
      char_count: (s.content ?? "").length,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to add source" };

  revalidatePath(`/p/${s.propertyId}/chatbots/${s.chatbotId}`);
  return { sourceId: data.id };
}

/**
 * Edit an existing text/qa source's title + content (and question for qa).
 * Editing resets status to `pending` so the "you changed it but didn't
 * retrain" state stays honest — the chunks are stale until Train runs again.
 * Snapshot kinds (document/url) aren't editable here; they re-fetch at train.
 */
export async function updateKnowledgeSource(input: {
  sourceId: string;
  title: string;
  content?: string;
  question?: string;
}): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(input.sourceId);
  if (!id.success) return { error: "Invalid source" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing, error: loadError } = await supabase
    .from("chatbot_knowledge_sources")
    .select("kind")
    .eq("id", id.data)
    .maybeSingle();
  if (loadError) return { error: loadError.message };
  if (!existing) return { error: "Source not found" };
  if (existing.kind !== "text" && existing.kind !== "qa") {
    return { error: "Only text and Q&A sources can be edited" };
  }

  const title = input.title.trim();
  const content = (input.content ?? "").trim();
  const question = (input.question ?? "").trim();
  if (!title) return { error: "Title is required" };
  if (!content) return { error: "Content is required" };
  if (existing.kind === "qa" && !question) {
    return { error: "Question is required" };
  }

  const { data, error } = await supabase
    .from("chatbot_knowledge_sources")
    .update({
      title,
      content,
      question: existing.kind === "qa" ? question : null,
      char_count: content.length,
      status: "pending",
      error: null,
    })
    .eq("id", id.data)
    .select("property_id, chatbot_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Source not found" };

  revalidatePath(`/p/${data.property_id}/chatbots/${data.chatbot_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Staff-channel deployments
// ---------------------------------------------------------------------------

/** Replace this bot's channel deployments with the given set. One bot per
 *  channel (unique index) — deploying over another bot's channel errors. */
export async function setChannelDeployments(input: {
  chatbotId: string;
  propertyId: string;
  streamChannelIds: string[];
}): Promise<{ ok: true } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const bid = Uuid.safeParse(input.chatbotId);
  if (!pid.success || !bid.success) return { error: "Invalid input" };
  const channelIds = [...new Set(input.streamChannelIds)].slice(0, 20);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing } = await supabase
    .from("chatbot_channel_deployments")
    .select("id, stream_channel_id")
    .eq("chatbot_id", bid.data);
  const current = new Set((existing ?? []).map((d) => d.stream_channel_id));

  const toRemove = (existing ?? []).filter(
    (d) => !channelIds.includes(d.stream_channel_id),
  );
  if (toRemove.length > 0) {
    await supabase
      .from("chatbot_channel_deployments")
      .delete()
      .in("id", toRemove.map((d) => d.id));
  }

  const toAdd = channelIds.filter((id) => !current.has(id));
  if (toAdd.length > 0) {
    const { error } = await supabase.from("chatbot_channel_deployments").insert(
      toAdd.map((streamChannelId) => ({
        chatbot_id: bid.data,
        property_id: pid.data,
        stream_channel_id: streamChannelId,
        created_by: user.id,
      })),
    );
    if (error) {
      return {
        error: error.code === "23505"
          ? "One of those channels already has a different bot deployed"
          : error.message,
      };
    }
  }

  // Deployment persona/tools resolve at eve session START — reset the
  // affected channels' durable sessions so the change applies on the next
  // message instead of whenever the old session happens to expire.
  const affected = [
    ...new Set([...toRemove.map((d) => d.stream_channel_id), ...toAdd]),
  ];
  if (affected.length > 0) {
    try {
      await createServiceClient()
        .from("channel_bot_sessions")
        .delete()
        .in("channel_id", affected);
    } catch (err) {
      console.error("[chatbots] session reset after deployment change failed", err);
    }
  }

  revalidatePath(`/p/${pid.data}/chatbots/${bid.data}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Custom HTTP actions
// ---------------------------------------------------------------------------

const ParamField = z.object({
  id: z.string().min(1),
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Parameter names must be identifiers"),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(300),
  required: z.boolean(),
});

const CustomActionInput = z.object({
  id: Uuid.optional(),
  chatbotId: Uuid,
  propertyId: Uuid,
  name: z.string().trim().min(1).max(80),
  whenToUse: z.string().max(500).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u.startsWith("https://"), "Only https:// URLs are allowed"),
  /** value is plaintext for new/changed headers; undefined keeps the stored secret. */
  headers: z
    .array(z.object({ name: z.string().trim().min(1).max(80), value: z.string().max(2000).optional() }))
    .max(8),
  bodyTemplate: z.string().max(8000).nullable().optional(),
  params: z.array(ParamField).max(8),
  responseAllowlist: z.array(z.string().trim().min(1).max(120)).max(20),
  enabled: z.boolean(),
});

export async function saveCustomAction(
  input: z.input<typeof CustomActionInput>,
): Promise<{ actionId: string } | ActionError> {
  const parsed = CustomActionInput.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid action" };
  }
  const a = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Lazy import keeps node:crypto out of any client bundle graph.
  const { encryptSecret } = await import("@/lib/chatbots/crypto");

  // Preserve stored secrets for headers whose value wasn't re-entered.
  let existing: { name: string; value_encrypted: string }[] = [];
  if (a.id) {
    const { data: row } = await supabase
      .from("chatbot_custom_actions")
      .select("headers")
      .eq("id", a.id)
      .maybeSingle();
    existing = row?.headers ?? [];
  }
  const headers: { name: string; value_encrypted: string }[] = [];
  for (const h of a.headers) {
    if (h.value !== undefined && h.value !== "") {
      headers.push({ name: h.name, value_encrypted: encryptSecret(h.value) });
    } else {
      const kept = existing.find((e) => e.name === h.name);
      if (kept) headers.push(kept);
    }
  }

  const record = {
    name: a.name,
    when_to_use: a.whenToUse?.trim() || null,
    method: a.method,
    url: a.url,
    headers,
    body_template: a.method === "GET" ? null : a.bodyTemplate?.trim() || null,
    param_schema: a.params,
    response_allowlist: a.responseAllowlist,
    enabled: a.enabled,
  };

  const query = a.id
    ? supabase.from("chatbot_custom_actions").update(record).eq("id", a.id).select("id").maybeSingle()
    : supabase
        .from("chatbot_custom_actions")
        .insert({
          ...record,
          chatbot_id: a.chatbotId,
          property_id: a.propertyId,
          created_by: user.id,
        })
        .select("id")
        .maybeSingle();
  const { data, error } = await query;
  if (error || !data) return { error: error?.message ?? "Failed to save action" };

  revalidatePath(`/p/${a.propertyId}/chatbots/${a.chatbotId}`);
  return { actionId: data.id };
}

export async function deleteCustomAction(
  actionId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(actionId);
  if (!id.success) return { error: "Invalid action" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("chatbot_custom_actions")
    .delete()
    .eq("id", id.data)
    .select("property_id, chatbot_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Action not found" };

  revalidatePath(`/p/${data.property_id}/chatbots/${data.chatbot_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Escalated-conversation handling (staff side)
// ---------------------------------------------------------------------------

/**
 * Resolve a conversation the caller is allowed to touch: the RLS-scoped
 * read proves membership; writes then go through the service client
 * (guests own these rows — members have no UPDATE/INSERT policies).
 */
async function authorizeConversation(conversationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: convo } = await supabase
    .from("chatbot_conversations")
    .select("id, property_id, chatbot_id, status, message_count, channel, session_token")
    .eq("id", conversationId)
    .maybeSingle();
  return convo ? { user, convo } : null;
}

/** Staff reply into a guest conversation. Taking over implicitly mutes the
 *  bot — replying while the bot is active flips status to 'human'. */
export async function sendStaffReply(input: {
  conversationId: string;
  text: string;
}): Promise<{ ok: true } | ActionError> {
  const text = input.text.trim();
  if (!text || text.length > 4000) return { error: "Invalid message" };
  const auth = await authorizeConversation(input.conversationId);
  if (!auth) return { error: "Conversation not found" };

  const service = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await service.from("chatbot_messages").insert({
    conversation_id: auth.convo.id,
    property_id: auth.convo.property_id,
    role: "staff",
    content: text,
    created_at: now,
  });
  if (error) return { error: error.message };
  await service
    .from("chatbot_conversations")
    .update({
      status: "human",
      message_count: auth.convo.message_count + 1,
      last_message_at: now,
    })
    .eq("id", auth.convo.id);

  // WhatsApp/SMS conversations: push the reply to the guest's phone. The
  // session_token IS their number on these channels. Fail-soft — without
  // Twilio creds the reply still lands in the transcript.
  if (auth.convo.channel === "whatsapp" || auth.convo.channel === "sms") {
    const { sendTwilioMessage, twilioSendConfigured } = await import(
      "@/lib/chatbots/twilio"
    );
    if (twilioSendConfigured()) {
      const { data: bot } = await service
        .from("chatbots")
        .select("twilio_number")
        .eq("id", auth.convo.chatbot_id)
        .maybeSingle();
      if (bot?.twilio_number) {
        await sendTwilioMessage({
          to: auth.convo.session_token,
          from: bot.twilio_number,
          body: text,
        });
      }
    }
  }
  return { ok: true };
}

/** Hand the conversation back to the bot (with a transcript note so the
 *  bot knows a human stepped in), or close it out with an outcome. */
export async function setConversationState(input: {
  conversationId: string;
  state: "bot" | "closed";
  outcome?: "resolved" | "unresolved";
}): Promise<{ ok: true } | ActionError> {
  const auth = await authorizeConversation(input.conversationId);
  if (!auth) return { error: "Conversation not found" };

  const service = createServiceClient();
  if (input.state === "bot" && auth.convo.status !== "bot") {
    await service.from("chatbot_messages").insert({
      conversation_id: auth.convo.id,
      property_id: auth.convo.property_id,
      role: "system",
      content:
        "A staff member handled the conversation above. The assistant is back to help with anything else.",
    });
  }
  const { error } = await service
    .from("chatbot_conversations")
    .update({
      status: input.state,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    })
    .eq("id", auth.convo.id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteKnowledgeSource(
  sourceId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(sourceId);
  if (!id.success) return { error: "Invalid source" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("chatbot_knowledge_sources")
    .delete()
    .eq("id", id.data)
    .select("property_id, chatbot_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Source not found" };

  revalidatePath(`/p/${data.property_id}/chatbots/${data.chatbot_id}`);
  return { ok: true };
}
