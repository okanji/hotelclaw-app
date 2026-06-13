import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { executeCustomAction } from "@/lib/chatbots/custom-actions";
import { encryptSecret } from "@/lib/chatbots/crypto";

/**
 * POST .../custom-actions/test — the wizard's "Test request" step. Runs the
 * action draft (or a saved action by id, so stored secrets work without
 * re-entering them) through the exact production executor — same SSRF
 * guard, timeout, size cap, and response allowlist — and returns what the
 * MODEL would see.
 */

export const maxDuration = 30;

const Draft = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  url: z.string().max(2000),
  headers: z
    .array(z.object({ name: z.string().max(80), value: z.string().max(2000).optional() }))
    .max(8),
  bodyTemplate: z.string().max(8000).nullable().optional(),
  params: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        description: z.string(),
        required: z.boolean(),
      }),
    )
    .max(8),
  responseAllowlist: z.array(z.string()).max(20),
});

const Body = z.object({
  actionId: z.string().uuid().optional(),
  draft: Draft,
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; chatbotId: string }> },
) {
  const { propertyId, chatbotId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  // Stored secrets for headers the user didn't re-type in the wizard.
  let stored: { name: string; value_encrypted: string }[] = [];
  if (body.actionId) {
    const { data: row } = await supabase
      .from("chatbot_custom_actions")
      .select("headers")
      .eq("id", body.actionId)
      .eq("chatbot_id", chatbotId)
      .maybeSingle();
    stored = row?.headers ?? [];
  }
  const headers = body.draft.headers.flatMap((h) => {
    if (h.value !== undefined && h.value !== "") {
      return [{ name: h.name, value_encrypted: encryptSecret(h.value) }];
    }
    const kept = stored.find((s) => s.name === h.name);
    return kept ? [kept] : [];
  });

  const result = await executeCustomAction(
    {
      method: body.draft.method,
      url: body.draft.url,
      headers,
      body_template: body.draft.bodyTemplate ?? null,
      param_schema: body.draft.params,
      response_allowlist: body.draft.responseAllowlist,
    },
    body.values,
  );
  return NextResponse.json(result);
}
