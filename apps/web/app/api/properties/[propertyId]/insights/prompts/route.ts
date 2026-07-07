import { NextResponse, type NextRequest, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  refreshPinnedPrompt,
  type InsightPromptRow,
} from "@/lib/ai/bots/insights-qa-bot";
import { parseScope } from "@/lib/insights/scope";

/**
 * The caller's pinned insight prompts.
 *   GET  → list; stale answers regenerate in after() (fingerprint-gated, so
 *          an unchanged board costs nothing) and land via the poll.
 *   POST {prompt, scope} → pin (capped per user); first answer generates in
 *          after().
 * Owner/manager only — answers come from the Q&A toolset.
 */

const MAX_PROMPTS = 8;

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { data, error } = await auth.supabase
    .from("insight_prompts")
    .select(
      "id, property_id, user_id, prompt, scope, answer_md, fingerprint, generated_at",
    )
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prompts = (data ?? []) as InsightPromptRow[];
  after(async () => {
    for (const row of prompts) {
      try {
        await refreshPinnedPrompt(row);
      } catch (err) {
        console.error("[insight-prompts] refresh failed", row.id, err);
      }
    }
  });
  return NextResponse.json({
    prompts: prompts.map(toClient),
    pending: prompts.some((p) => p.answer_md === null),
  });
}

const PostBody = z.object({
  prompt: z.string().min(4).max(300),
  scope: z.string().default("property"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = PostBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parseScope(parsed.data.scope)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { count } = await auth.supabase
    .from("insight_prompts")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id);
  if ((count ?? 0) >= MAX_PROMPTS) {
    return NextResponse.json(
      { error: `you can pin up to ${MAX_PROMPTS} questions` },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase
    .from("insight_prompts")
    .insert({
      property_id: propertyId,
      user_id: auth.user.id,
      prompt: parsed.data.prompt.trim(),
      scope: parsed.data.scope,
    })
    .select(
      "id, property_id, user_id, prompt, scope, answer_md, fingerprint, generated_at",
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data as InsightPromptRow;
  after(async () => {
    try {
      await refreshPinnedPrompt(row);
    } catch (err) {
      console.error("[insight-prompts] first answer failed", row.id, err);
    }
  });
  return NextResponse.json({ prompt: toClient(row) });
}

function toClient(p: InsightPromptRow) {
  return {
    id: p.id,
    prompt: p.prompt,
    scope: p.scope,
    answerMd: p.answer_md,
    generatedAt: p.generated_at,
  };
}
