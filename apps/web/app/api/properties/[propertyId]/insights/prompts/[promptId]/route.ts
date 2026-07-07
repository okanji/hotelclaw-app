import { NextResponse, type NextRequest, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  refreshPinnedPrompt,
  type InsightPromptRow,
} from "@/lib/ai/bots/insights-qa-bot";

/**
 * POST   → force re-answer one pinned prompt (ignores the fingerprint).
 * DELETE → unpin. RLS pins both to the caller's own rows.
 */

async function authed(propertyId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 as const };
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role === "staff") return { error: 403 as const };
  return { supabase, user };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; promptId: string }> },
) {
  const { propertyId, promptId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { data } = await auth.supabase
    .from("insight_prompts")
    .select(
      "id, property_id, user_id, prompt, scope, answer_md, fingerprint, generated_at",
    )
    .eq("id", promptId)
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const row = data as InsightPromptRow;
  after(async () => {
    try {
      await refreshPinnedPrompt(row, { force: true });
    } catch (err) {
      console.error("[insight-prompts] forced refresh failed", row.id, err);
    }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; promptId: string }> },
) {
  const { propertyId, promptId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { error } = await auth.supabase
    .from("insight_prompts")
    .delete()
    .eq("id", promptId)
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
