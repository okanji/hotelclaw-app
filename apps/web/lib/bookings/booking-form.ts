import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import {
  formatAnswer,
  inputFields,
  parseFormSchema,
  validateAnswers,
  type FormAnswers,
  type FormField,
} from "@/lib/forms/schema";

/**
 * Booking questions — a published form (Forms feature) attached to a
 * bookable service via `schedule.formId`. Guests answer while booking;
 * responses land in form_responses (source 'booking') and a one-line
 * summary rides the booking notes so staff see it on every surface.
 */

export type BookingFormPayload = {
  formId: string;
  title: string;
  fields: FormField[];
};

/** Guest-safe questions for a service: the published form minus sourced
 *  selects and file uploads (member-only machinery a guest can't use). */
export async function loadBookingForm(
  formId: string | undefined,
  propertyId: string,
): Promise<BookingFormPayload | null> {
  if (!formId) return null;
  const supabase = createServiceClient();
  const { data: form } = await supabase
    .from("forms")
    .select("id, title, schema, status, property_id")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!form || form.status !== "published") return null;
  const schema = parseFormSchema(form.schema);
  const fields = schema.fields.filter((f) => f.type !== "file" && !f.source);
  if (inputFields({ version: 1, fields }).length === 0) return null;
  return { formId: form.id, title: form.title, fields };
}

export function validateBookingAnswers(fields: FormField[], answers: FormAnswers) {
  return validateAnswers({ version: 1, fields }, answers);
}

/**
 * Model-facing description of a service's booking questions — used by the
 * guest chatbot to know what to ask conversationally before it books.
 * Field ids are exposed so the bot can echo answers back keyed by id;
 * choice options carry both id and label (the bot may pass either —
 * `coerceBookingAnswers` normalizes).
 */
export function describeBookingQuestions(fields: FormField[]) {
  return inputFields({ version: 1, fields }).map((f) => ({
    field_id: f.id,
    question: f.label,
    ...(f.description ? { help: f.description } : {}),
    type: f.type,
    required: Boolean(f.required),
    ...(f.type === "select" || f.type === "multi_select"
      ? { options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })) }
      : {}),
    ...(f.type === "rating" ? { scale: f.maxRating ?? 5 } : {}),
  }));
}

/**
 * Normalize loose LLM-supplied answers to the canonical shape `validateAnswers`
 * expects. The model is told to use option ids and booleans, but it drifts —
 * so accept option LABELS too (case-insensitive), "yes"/"no" strings for
 * yes_no, and numeric strings for number/rating. Unknown keys are dropped.
 */
export function coerceBookingAnswers(
  fields: FormField[],
  raw: Record<string, unknown>,
): FormAnswers {
  const byId = new Map(inputFields({ version: 1, fields }).map((f) => [f.id, f]));
  const out: FormAnswers = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const field = byId.get(key);
    if (!field || value === undefined || value === null) continue;

    const optionId = (raw: unknown): string | undefined => {
      const s = String(raw).trim().toLowerCase();
      const opt =
        (field.options ?? []).find((o) => o.id.toLowerCase() === s) ??
        (field.options ?? []).find((o) => o.label.toLowerCase() === s);
      return opt?.id;
    };

    switch (field.type) {
      case "select": {
        const id = optionId(value);
        if (id) out[field.id] = id;
        break;
      }
      case "multi_select": {
        const arr = Array.isArray(value) ? value : [value];
        const ids = arr.map(optionId).filter((v): v is string => Boolean(v));
        if (ids.length) out[field.id] = ids;
        break;
      }
      case "yes_no": {
        if (typeof value === "boolean") out[field.id] = value;
        else {
          const s = String(value).trim().toLowerCase();
          if (["yes", "y", "true"].includes(s)) out[field.id] = true;
          else if (["no", "n", "false"].includes(s)) out[field.id] = false;
        }
        break;
      }
      case "number":
      case "rating": {
        const n = typeof value === "number" ? value : Number(String(value).trim());
        if (Number.isFinite(n)) out[field.id] = n;
        break;
      }
      default: {
        const s = String(value).trim();
        if (s) out[field.id] = s;
      }
    }
  }
  return out;
}

/**
 * Persist a guest's booking-form answers as a `form_responses` row
 * (source 'booking', anonymous). Shared by the web route and the chatbot;
 * fail-soft — the booking already carries the notes summary, so a failed
 * insert is logged, not fatal. The booking reference is embedded in answers
 * (no FK column) to tie the response back to its booking.
 */
export async function recordBookingFormResponse(args: {
  formId: string;
  propertyId: string;
  answers: FormAnswers;
  reference: string;
}): Promise<void> {
  if (Object.keys(args.answers).length === 0) return;
  const { error } = await createServiceClient()
    .from("form_responses")
    .insert({
      form_id: args.formId,
      property_id: args.propertyId,
      respondent_id: null,
      answers: { ...args.answers, _booking_reference: args.reference },
      source: "booking",
    });
  if (error) console.error("[booking-form] response insert failed", error);
}

/** "Dietary: vegan · Waiver: Yes" — the staff-facing one-liner for notes. */
export function summarizeAnswers(fields: FormField[], answers: FormAnswers): string {
  return inputFields({ version: 1, fields })
    .map((f) => {
      const value = answers[f.id];
      if (value === undefined || value === null || value === "") return null;
      return `${f.label}: ${formatAnswer(f, value)}`;
    })
    .filter(Boolean)
    .join(" · ")
    .slice(0, 600);
}
