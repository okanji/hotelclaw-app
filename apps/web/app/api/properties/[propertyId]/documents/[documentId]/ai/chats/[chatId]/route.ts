import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * A single document AI chat.
 *
 *   GET    …/ai/chats/:chatId   → its messages (oldest first)
 *   PATCH  …/ai/chats/:chatId   → rename ({ title })
 *   DELETE …/ai/chats/:chatId   → delete the chat (messages cascade)
 *
 * RLS gates rows to property members; explicit checks give clean errors and
 * verify the chat actually belongs to this document.
 */

async function authorizeChat(
  propertyId: string,
  documentId: string,
  chatId: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const, status: 401 };

  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return { error: "forbidden" as const, status: 403 };

  const { data: chat } = await supabase
    .from("doc_ai_chats")
    .select("id")
    .eq("id", chatId)
    .eq("document_id", documentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!chat) return { error: "chat not found" as const, status: 404 };

  return { supabase };
}

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      propertyId: string;
      documentId: string;
      chatId: string;
    }>;
  },
) {
  const { propertyId, documentId, chatId } = await params;
  const auth = await authorizeChat(propertyId, documentId, chatId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("doc_ai_messages")
    .select("id, role, content, edit, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[doc-ai-chats] messages failed", error);
    return NextResponse.json({ error: "messages failed" }, { status: 500 });
  }
  return NextResponse.json({ messages: data ?? [] });
}

const PatchBody = z.object({ title: z.string().min(1).max(200) });

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      propertyId: string;
      documentId: string;
      chatId: string;
    }>;
  },
) {
  const { propertyId, documentId, chatId } = await params;
  const auth = await authorizeChat(propertyId, documentId, chatId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("doc_ai_chats")
    .update({ title: parsed.data.title })
    .eq("id", chatId);
  if (error) {
    console.error("[doc-ai-chats] rename failed", error);
    return NextResponse.json({ error: "rename failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      propertyId: string;
      documentId: string;
      chatId: string;
    }>;
  },
) {
  const { propertyId, documentId, chatId } = await params;
  const auth = await authorizeChat(propertyId, documentId, chatId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { error } = await auth.supabase
    .from("doc_ai_chats")
    .delete()
    .eq("id", chatId);
  if (error) {
    console.error("[doc-ai-chats] delete failed", error);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
