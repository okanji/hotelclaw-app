import {
  FormSchemaZod,
  newFieldId,
  type FormField,
  type FormSchema,
} from "./schema";

/**
 * Pure helpers behind the form builder's autosave (studio port, 2026-10-25).
 *
 * The builder edits a working copy that is allowed to be momentarily
 * incomplete — an option row the person just added with Enter is empty, a
 * label is cleared mid-retype. The persisted contract (`FormSchemaZod`) is
 * stricter (labels are min(1)), so every autosave goes through
 * `persistableSchema`: blank option rows are dropped silently (they are
 * still on screen and will save once typed into), and a question with no
 * label HOLDS the save with a human reason instead of letting the server
 * action reject it as "Invalid input".
 */

export type PersistResult =
  | { ok: true; schema: FormSchema }
  | { ok: false; reason: string; fieldId?: string };

export function persistableSchema(working: FormSchema): PersistResult {
  const fields: FormField[] = [];
  for (const [index, field] of working.fields.entries()) {
    if (!field.label.trim()) {
      return {
        ok: false,
        reason: `Question ${index + 1} needs a title before it can save`,
        fieldId: field.id,
      };
    }
    const next: FormField = { ...field };
    if (field.options) {
      next.options = field.options.filter((o) => o.label.trim().length > 0);
    }
    fields.push(next);
  }
  const candidate: FormSchema = { ...working, fields };
  const parsed = FormSchemaZod.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: "Some of the form couldn't be saved — check the last change" };
  }
  return { ok: true, schema: parsed.data };
}

/** Insert `field` at `index` (clamped). */
export function insertFieldAt(
  fields: FormField[],
  index: number,
  field: FormField,
): FormField[] {
  const at = Math.max(0, Math.min(index, fields.length));
  return [...fields.slice(0, at), field, ...fields.slice(at)];
}

/**
 * A copy of `field` placed right after it, with fresh ids. Task-property
 * presets keep their semantic option ids ("urgent" IS the priority value);
 * plain lists get new ones so the copy's answers never collide. A condition
 * is kept — it still points at an earlier question.
 */
export function duplicateFieldIn(
  fields: FormField[],
  id: string,
): { fields: FormField[]; copyId: string | null } {
  const index = fields.findIndex((f) => f.id === id);
  if (index < 0) return { fields, copyId: null };
  const original = fields[index];
  const copy: FormField = {
    ...original,
    id: newFieldId(),
    label: `${original.label} (copy)`,
    options: original.taskProperty
      ? original.options
      : original.options?.map((o) => ({ ...o, id: newFieldId() })),
  };
  return { fields: insertFieldAt(fields, index + 1, copy), copyId: copy.id };
}

/**
 * Remove a field; conditions that referenced it are dropped too (they would
 * fail open at render time anyway, but the builder should never show a
 * stale rule).
 */
export function removeFieldFrom(fields: FormField[], id: string): FormField[] {
  return fields
    .filter((f) => f.id !== id)
    .map((f) => (f.condition?.fieldId === id ? { ...f, condition: undefined } : f));
}
