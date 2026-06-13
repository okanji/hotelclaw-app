import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  FORM_FIELD_TYPES,
  FormSchemaZod,
  newFieldId,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";

// POST /api/properties/:propertyId/forms/generate — describe a form in
// plain language, get back a title/description and a validated FormSchema.
// The model only ever names fields; ids are assigned server-side so the
// stored schema can't carry model-invented identifiers.

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

const Body = z.object({ prompt: z.string().trim().min(1).max(2000) });

// What the model fills in — a label-only mirror of FormFieldZod. Option ids
// and field ids are assigned after generation.
const GeneratedForm = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  fields: z
    .array(
      z.object({
        type: z.enum(FORM_FIELD_TYPES),
        label: z.string().min(1).max(200),
        description: z.string().max(300).optional(),
        placeholder: z.string().max(120).optional(),
        required: z.boolean().optional(),
        options: z.array(z.string().min(1).max(120)).optional(),
        // Data-connected options: the app resolves these live, so the model
        // names a source instead of inventing an option list. sheet_column is
        // excluded — it needs a document id the model can't know.
        source: z
          .enum(["members", "projects", "tasks", "spaces", "labels"])
          .optional(),
        maxRating: z.number().int().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .min(1)
    .max(12),
});

function optionId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return slug || newFieldId();
}

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

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let generated: z.infer<typeof GeneratedForm>;
  try {
    const result = await generateText({
      model: anthropic(GENERATE_MODEL),
      output: Output.object({ schema: GeneratedForm }),
      temperature: 0,
      maxRetries: 3,
      system: [
        "You design internal operations forms for a hotel/restaurant team workspace (maintenance, housekeeping, F&B, front desk, staff feedback).",
        "Rules:",
        "- Be concise: at most 12 fields, only what the request actually needs.",
        "- Pick the most sensible field type per question — select/multi_select for known categories, yes_no for binaries, rating for satisfaction, number for quantities, date for dates.",
        "- Options lists have at most 8 entries.",
        "- For questions answered by picking a person/project/task/team/label that exists in the workspace (e.g. 'Who is reporting this?', 'Which project is this for?', 'Which team?'), set `source` to members/projects/tasks/spaces/labels and omit `options` — the app fills the options live from workspace data.",
        "- Use a `file` field when photos or documents would help (e.g. photo evidence on a maintenance or incident form).",
        "- If the form has more than 6 fields, group related ones under `section` blocks (a section is a heading, not a question).",
        "- Mark a field required only when the form is useless without it.",
        "- Labels are short questions or nouns, not sentences.",
      ].join("\n"),
      prompt: body.prompt,
    });
    generated = result.output;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }

  // Map the label-only output to a real FormSchema: server-assigned ids,
  // type-appropriate extras only, then a final FormSchemaZod.parse so
  // nothing invalid ever reaches createForm.
  const fields: FormField[] = generated.fields.map((f) => {
    // A sourced field is always a choice field: keep multi_select if the
    // model picked it, otherwise force select. Options come live from the
    // app, so any generated option list is dropped.
    const type = f.source
      ? f.type === "multi_select"
        ? "multi_select"
        : "select"
      : f.type;
    const isChoice = type === "select" || type === "multi_select";
    const seen = new Set<string>();
    return {
      id: newFieldId(),
      type,
      label: f.label,
      description: f.description || undefined,
      placeholder: type === "section" || isChoice ? undefined : f.placeholder || undefined,
      required: type === "section" ? undefined : (f.required ?? undefined),
      options:
        isChoice && !f.source
          ? (f.options ?? []).slice(0, 8).map((label) => {
              let id = optionId(label);
              while (seen.has(id)) id = newFieldId();
              seen.add(id);
              return { id, label };
            })
          : undefined,
      source: f.source ? { kind: f.source } : undefined,
      min: type === "number" ? f.min : undefined,
      max: type === "number" ? f.max : undefined,
      maxRating:
        type === "rating" && f.maxRating !== undefined
          ? Math.min(10, Math.max(3, Math.round(f.maxRating)))
          : undefined,
    };
  });

  let schema: FormSchema;
  try {
    schema = FormSchemaZod.parse({ version: 1, fields });
  } catch {
    return NextResponse.json({ error: "generated schema was invalid" }, { status: 500 });
  }

  return NextResponse.json({
    title: generated.title,
    description: generated.description ?? null,
    schema,
  });
}
