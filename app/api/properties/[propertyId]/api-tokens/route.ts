import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { mintToken } from "@/lib/mcp/tokens";

/**
 * Property API tokens (the MCP credential). Owner only.
 *   GET  → token metadata (never hashes, never plaintext)
 *   POST {name} → mint; the plaintext is returned ONCE in this response.
 */

async function ownerAuthed(propertyId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 as const };
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role !== "owner") return { error: 403 as const };
  return { user };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await ownerAuthed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const service = createServiceClient();
  const { data, error } = await service
    .from("api_tokens")
    .select("id, name, created_at, last_used_at, revoked_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data ?? [] });
}

const Body = z.object({ name: z.string().min(1).max(80) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await ownerAuthed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { token, hash } = mintToken();
  const service = createServiceClient();
  const { data, error } = await service
    .from("api_tokens")
    .insert({
      property_id: propertyId,
      name: parsed.data.name.trim(),
      token_hash: hash,
      created_by: auth.user.id,
    })
    .select("id, name, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The only time the plaintext ever leaves the server.
  return NextResponse.json({ token, id: data.id, name: data.name });
}
