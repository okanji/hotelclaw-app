import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMembershipForProperty } from "@/lib/auth/session";
import { generateChatbotDraft } from "@/lib/chatbots/generate";

// POST /api/properties/:propertyId/chatbots/generate — describe a chatbot in
// plain language, get back a validated ChatbotConfig draft (forms/generate
// pattern). Generation logic is shared with the onboarding chatbot workflow —
// see lib/chatbots/generate.ts.

const Body = z.object({ description: z.string().trim().min(1).max(2000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const { config, knowledgeChecklist } = await generateChatbotDraft(
      body.description,
    );
    return NextResponse.json({ config, knowledgeChecklist });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
