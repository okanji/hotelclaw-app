import type { CustomFieldType } from "@/lib/db/types";
import type { FormFieldType } from "@/lib/forms/schema";

/**
 * Which custom-field types a form answer can be saved into (0116, ClickUp's
 * "map question to task field"). The value goes through the shared
 * `coerceFieldValue` at run time, so this list only has to be honest about
 * what CAN coerce: a select answer is matched to the field's options by
 * LABEL, a file answer is copied onto the task as attachments in that slot.
 */
export const FORM_TO_FIELD_COMPATIBLE: Record<FormFieldType, readonly CustomFieldType[]> = {
  short_text: ["text", "long_text", "url", "email", "phone"],
  long_text: ["long_text", "text"],
  email: ["email", "text"],
  phone: ["phone", "text"],
  number: ["number", "currency"],
  rating: ["number"],
  select: ["select", "text"],
  multi_select: ["multi_select"],
  yes_no: ["checkbox"],
  consent: ["checkbox"],
  date: ["date"],
  people: ["people"],
  file: ["files"],
  signature: [],
  section: [],
  info: [],
};

export function canMapToField(formType: FormFieldType, fieldType: CustomFieldType): boolean {
  return FORM_TO_FIELD_COMPATIBLE[formType].includes(fieldType);
}
