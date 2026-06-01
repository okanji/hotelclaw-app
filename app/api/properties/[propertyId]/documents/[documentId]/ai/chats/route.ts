import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Document AI chats — list + create.
 *
 *   GET  /api/properties/:p/documents/:d/ai/chats   → chats for this doc
 *   POST /api/properties/:p/documents/:d/ai/chats   → create an empty chat
 *
 * RLS (migration 0031) restricts rows to property members; we add explicit
 * membership + doc-ownership checks for clean 403/404s.
 */

async function authorize(propertyId: string, documentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const, status: 401 };

  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return { error: "forbidden" as const, status: 403 };

  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc) return { error: "document not found" as const, status: 404 };

  return { supabase, user };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; documentId: string }> },
) {
  const { propertyId, documentId } = await params;
  const auth = await authorize(propertyId, documentId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("doc_ai_chats")
    .select("id, title, created_at, updated_at")
    .eq("document_id", documentId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[doc-ai-chats] list failed", error);
    return NextResponse.json({ error: "list failed" }, { status: 500 });
  }
  return NextResponse.json({ chats: data ?? [] });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; documentId: string }> },
) {
  const { propertyId, documentId } = await params;
  const auth = await authorize(propertyId, documentId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("doc_ai_chats")
    .insert({
      document_id: documentId,
      property_id: propertyId,
      created_by: auth.user.id,
    })
    .select("id, title, created_at, updated_at")
    .single();
  if (error || !data) {
    console.error("[doc-ai-chats] create failed", error);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
  return NextResponse.json({ chat: data });
}
