import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runDocBot } from "@/lib/ai/bots/doc-bot";
import type { ModelMessage } from "@/lib/ai/run-bot";

/**
 * POST /api/properties/:propertyId/documents/:documentId/ai
 *
 * One document-assistant turn, persisted to a chat (migration 0031). The
 * client posts a single new `message` + the target `chatId` (omit it to start
 * a fresh chat); the server loads that chat's history, runs the bot, persists
 * both the user and assistant turns (incl. any staged `edit`), and returns the
 * reply. History is the DB's responsibility, so the client no longer ships the
 * whole transcript each turn.
 *
 * Auth: caller must be a member of the property. RLS enforces it at the data
 * layer too; the explicit checks give clean 4xx errors.
 */

const Body = z.object({
  /** Omit to start a new chat (one is created and its id returned). */
  chatId: z.string().uuid().optional(),
  /** The new user message. */
  message: z.string().min(1),
  /** Live editor HTML — lets the bot reproduce unchanged blocks for clean diffs. */
  documentHtml: z.string().optional(),
});

const TITLE_MAX = 80;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; documentId: string }> },
) {
  const { propertyId, documentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Verify the doc belongs to this property — propertyId-spoofing defense.
  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    console.error("[doc-bot] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { message, documentHtml } = parsed.data;

  // Resolve the chat: validate an existing one belongs to this doc, or create
  // a fresh chat titled from this first message.
  let chatId = parsed.data.chatId ?? null;
  let title: string | null = null;
  if (chatId) {
    const { data: chat } = await supabase
      .from("doc_ai_chats")
      .select("id, title")
      .eq("id", chatId)
      .eq("document_id", documentId)
      .maybeSingle();
    if (!chat) {
      return NextResponse.json({ error: "chat not found" }, { status: 404 });
    }
    title = chat.title;
  } else {
    title = message.trim().slice(0, TITLE_MAX);
    const { data: created, error: createErr } = await supabase
      .from("doc_ai_chats")
      .insert({
        document_id: documentId,
        property_id: propertyId,
        created_by: user.id,
        title,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      console.error("[doc-bot] chat create failed", createErr);
      return NextResponse.json({ error: "chat create failed" }, { status: 500 });
    }
    chatId = created.id;
  }

  // Load prior turns for context (DB is the source of truth).
  const { data: history } = await supabase
    .from("doc_ai_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const messages: ModelMessage[] = [
    ...(history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  let result: Awaited<ReturnType<typeof runDocBot>>;
  try {
    result = await runDocBot({
      propertyId,
      userId: user.id,
      documentId,
      messages,
      documentHtml,
    });
  } catch (err) {
    console.error("[doc-bot] runDocBot failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }

  // Persist both turns. Backfill the title if this chat had none yet.
  const { error: insertErr } = await supabase.from("doc_ai_messages").insert([
    { chat_id: chatId, role: "user", content: message },
    {
      chat_id: chatId,
      role: "assistant",
      content: result.text,
      edit: result.edit,
    },
  ]);
  if (insertErr) {
    console.error("[doc-bot] message persist failed", insertErr);
  }
  // Touch the chat so its list position + updated_at refresh, and set the
  // title on first turn.
  if (!title) title = message.trim().slice(0, TITLE_MAX);
  await supabase
    .from("doc_ai_chats")
    .update({ title })
    .eq("id", chatId);

  return NextResponse.json({
    chatId,
    title,
    reply: result.text,
    edit: result.edit,
  });
}
