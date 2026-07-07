import { NextResponse, type NextRequest } from "next/server";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import {
  AnswersSchema,
  PlanSchema,
  deterministicPlan,
  sanitizePlan,
} from "@/lib/onboarding/plan";

/**
 * POST /api/onboarding/plan
 *
 * Turn the wizard's answers into a personalized workspace plan (spaces,
 * channels, labels, one starter form, a welcome message). Any signed-in
 * user may call it — by definition they have no property yet, so there is
 * no membership to gate on.
 *
 * The model only *polishes* — department names come back verbatim; it
 * picks icons, colors, slugs, and which priorities deserve a channel or
 * form. No key, model error, or schema miss all fall back to
 * `deterministicPlan()`, so the build screen always gets a plan.
 */

export const maxDuration = 60;

// Cheap-tier model — same constant the other high-volume generators use
// (insights annotations, triage, shift briefs).
const PLAN_MODEL = "claude-haiku-4-5-20251001";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = AnswersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  }
  const answers = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ plan: deterministicPlan(answers), source: "fallback" });
  }

  try {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await generateText({
      model: anthropic(PLAN_MODEL),
      output: Output.object({ schema: PlanSchema }),
      temperature: 0,
      maxRetries: 3,
      system: [
        "You design the initial workspace for a hotel/restaurant operations app (chat channels, team spaces, task labels, one form).",
        "Rules:",
        "- `spaces` mirror THEIR departments — use their department names verbatim, one space per department, in the same order. You only choose the emoji icon, the color, and a lowercase a-z0-9- channel slug for each. At most 8.",
        "- `extraChannels` (max 4 total): always include `general` first, then 1-2 channels driven by their stated priorities (e.g. maintenance-requests, handovers, guest-feedback). Slugs lowercase a-z0-9- only. Don't duplicate a department channel.",
        "- `labels` (max 8): short task labels their priorities make immediately useful (e.g. Urgent, Guest issue, Deep clean, Daily). No filler.",
        "- `starterForm`: pick exactly ONE high-leverage form from their priorities (maintenance request, guest feedback, daily checklist, shift handover note…). 3-6 fields, concrete labels, sensible required flags. Use null only if no priority suggests a form.",
        "- `welcomeMessage`: 2-3 warm sentences posted to #general from the owner welcoming the team to the new workspace. Mention the property by name. No markdown headers.",
        "- Everything must be immediately useful to this specific property — never generic placeholders.",
      ].join("\n"),
      prompt: [
        "## Their setup answers",
        JSON.stringify(
          {
            propertyName: answers.propertyName,
            propertyType: answers.propertyType,
            teamSize: answers.teamSize,
            departments: answers.departments.map((d) => d.name),
            roleTitle: answers.roleTitle,
            priorities: answers.priorities,
          },
          null,
          2,
        ),
      ].join("\n"),
    });
    return NextResponse.json({ plan: sanitizePlan(result.output), source: "ai" });
  } catch (e) {
    console.error("[onboarding-plan] generation failed, using fallback", e);
    return NextResponse.json({ plan: deterministicPlan(answers), source: "fallback" });
  }
}
