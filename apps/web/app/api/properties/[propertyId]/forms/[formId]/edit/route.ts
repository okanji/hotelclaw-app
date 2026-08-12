import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  FORM_FIELD_TYPES,
  FormSchemaZod,
  newFieldId,
  parseFormSchema,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";

// POST /api/properties/:propertyId/forms/:formId/edit — natural-language
// edits to an existing form ("add a priority dropdown", "make room number
// required"). The model returns the FULL revised field list; fields that
// keep their `id` keep their identity (existing response answers stay
// keyed correctly), new fields get server-assigned ids. The result is the
// proposed working schema — the client applies it locally and the user
// still has to Save.

const EDIT_MODEL = "claude-haiku-4-5-20251001";

const Body = z.object({
  prompt: z.string().trim().min(1).max(2000),
  schema: z.unknown(),
});

const EditedForm = z.object({
  fields: z
    .array(
      z.object({
        // Present when the model keeps an existing field; omitted for new ones.
        id: z.string().optional(),
        type: z.enum(FORM_FIELD_TYPES),
        label: z.string().min(1).max(200),
        description: z.string().max(300).optional(),
        placeholder: z.string().max(120).optional(),
        required: z.boolean().optional(),
        options: z.array(z.string().min(1).max(120)).optional(),
        source: z
          .enum(["members", "projects", "tasks", "spaces", "labels"])
          .optional(),
        maxRating: z.number().int().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .min(0)
    .max(20),
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
  { params }: { params: Promise<{ propertyId: string; formId: string }> },
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

  const current = parseFormSchema(body.schema);
  const currentById = new Map(current.fields.map((f) => [f.id, f]));

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let edited: z.infer<typeof EditedForm>;
  try {
    const result = await generateText({
      model: anthropic(EDIT_MODEL),
      output: Output.object({ schema: EditedForm }),
      temperature: 0,
      maxRetries: 3,
      system: [
        "You edit an internal operations form for a hotel/restaurant team workspace. You receive the form's current fields as JSON and an instruction; return the FULL revised field list.",
        "Rules:",
        "- Keep every field the instruction doesn't mention, unchanged and in order, INCLUDING its exact `id`.",
        "- Fields you keep or modify must keep their original `id`. New fields have no id.",
        "- For choice options sourced from workspace data, set `source` (members/projects/tasks/spaces/labels) and omit `options`. Keep existing `source` bindings unless asked to change them.",
        "- Options lists have at most 8 entries; at most 20 fields total.",
        "- Labels are short questions or nouns, not sentences.",
      ].join("\n"),
      prompt: [
        "## Current fields",
        JSON.stringify(current.fields, null, 2),
        "",
        "## Instruction",
        body.prompt,
      ].join("\n"),
    });
    edited = result.output;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "edit failed" },
      { status: 500 },
    );
  }

  // Merge: kept ids inherit the existing field (so config the model can't
  // express, like a sheet_column source, survives), then model-provided
  // values override. Option ids are preserved where labels still match.
  const fields: FormField[] = edited.fields.map((f) => {
    const existing = f.id ? currentById.get(f.id) : undefined;
    const isChoice = f.type === "select" || f.type === "multi_select";
    const existingOptionsByLabel = new Map(
      (existing?.options ?? []).map((o) => [o.label.toLowerCase(), o.id]),
    );
    const seen = new Set<string>();

    const source = f.source
      ? { kind: f.source }
      : existing?.source && isChoice
        ? existing.source
        : undefined;

    return {
      id: existing?.id ?? newFieldId(),
      type: f.type,
      label: f.label,
      description: f.description || undefined,
      placeholder:
        f.type === "section" || isChoice ? undefined : f.placeholder || undefined,
      required: f.type === "section" ? undefined : (f.required ?? undefined),
      source,
      options:
        isChoice && !source
          ? (f.options ?? existing?.options?.map((o) => o.label) ?? [])
              .slice(0, 8)
              .map((label) => {
                let id = existingOptionsByLabel.get(label.toLowerCase()) ?? optionId(label);
                while (seen.has(id)) id = newFieldId();
                seen.add(id);
                return { id, label };
              })
          : undefined,
      min: f.type === "number" ? (f.min ?? existing?.min) : undefined,
      max: f.type === "number" ? (f.max ?? existing?.max) : undefined,
      // Config the model can't express survives on kept fields: task-property
      // mappings and conditional-visibility rules ride along untouched
      // (a condition whose controller was removed fails open at render).
      taskProperty: existing?.taskProperty,
      condition: existing?.condition,
      maxRating:
        f.type === "rating"
          ? f.maxRating !== undefined
            ? Math.min(10, Math.max(3, Math.round(f.maxRating)))
            : existing?.maxRating
          : undefined,
    };
  });

  let schema: FormSchema;
  try {
    // Presentation settings aren't part of the edit surface — carry them.
    schema = FormSchemaZod.parse({ version: 1, fields, settings: current.settings });
  } catch {
    return NextResponse.json({ error: "edited schema was invalid" }, { status: 500 });
  }

  return NextResponse.json({ schema });
}
