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
import { SOP_TEMPLATES } from "@/lib/onboarding/templates";

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
        "You design the initial workspace for a hotel/restaurant operations app (chat channels, team spaces, task labels, ready-to-use forms).",
        "Rules:",
        "- `spaces` mirror THEIR departments — use their department names verbatim, one space per department, in the same order. You only choose the emoji icon, the color, and a lowercase a-z0-9- channel slug for each. At most 8.",
        "- `extraChannels` (max 4 total): always include `general` first, then 1-2 channels driven by their stated priorities (e.g. maintenance-requests, handovers, guest-feedback). Slugs lowercase a-z0-9- only. Don't duplicate a department channel.",
        "- `labels` (max 8): short task labels their priorities make immediately useful (e.g. Urgent, Guest issue, Deep clean, Daily). No filler.",
        "- `forms` (0-4): high-leverage forms their priorities and operations call for (maintenance request, guest feedback, incident report, daily checklist, shift handover…). Each 3-6 fields with concrete labels, sensible required flags, and a single-emoji icon. Only forms this specific property would actually use — empty array if none fit.",
        "- `docs` (0-6): starter SOP / playbook documents. STRONGLY prefer picking from the hardcoded template catalog below via `templateId` — those seed with full, professionally written content. You may retitle a templated doc to fit the property, and you SHOULD add a one-sentence `intro` personalizing it (mention the property by name or a detail from their answers). Only invent a bare title (no templateId) for a doc genuinely outside the catalog. Each with a single-emoji icon.",
        "- `orgTitle`: the owner's job title from `roleTitle` (e.g. 'General Manager', 'Owner'). Null if they gave none.",
        "- `welcomeMessage`: 2-3 warm sentences posted to #general from the owner welcoming the team to the new workspace. Mention the property by name. No markdown headers.",
        "- Use `operations` (what they run on-site) and `guestContact` (how guests reach them) and any free-text `notes` to make forms/channels specific to how THIS property works.",
        "- Everything must be immediately useful to this specific property — never generic placeholders.",
      ].join("\n"),
      prompt: [
        "## SOP template catalog (for docs[].templateId)",
        SOP_TEMPLATES.map((t) => `- ${t.id}: "${t.title}" — ${t.summary}`).join(
          "\n",
        ),
        "",
        "## Their setup answers",
        JSON.stringify(
          {
            propertyName: answers.propertyName,
            propertyType: answers.propertyType,
            managementTeamSize: answers.teamSize,
            departments: answers.departments.map((d) => d.name),
            roleTitle: answers.roleTitle,
            priorities: answers.priorities,
            operations: answers.operations,
            guestContact: answers.guestContact,
            notes: answers.notes,
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
