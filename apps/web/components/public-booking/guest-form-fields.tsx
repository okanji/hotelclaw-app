"use client";

import type { FormAnswers, FormField } from "@/lib/forms/schema";

/**
 * Warm-palette renderer for a service's booking questions (the Forms
 * feature's schema, guest-safe subset). Sourced selects and file fields
 * never reach guests — the server filters them out — so this only handles
 * static field types. Validation is server-side; `errors` echoes it back
 * per field.
 */

/** The warm hairline — guest ink at 12% (see --guest-ink in globals.css). */
const HAIRLINE_CLASS = "border-guest-ink/[0.12]";

export function GuestFormFields({
  fields,
  answers,
  accent = "#c96442",
  errors = {},
  onChange,
}: {
  fields: FormField[];
  answers: FormAnswers;
  accent?: string;
  errors?: Record<string, string>;
  onChange: (fieldId: string, value: FormAnswers[string] | undefined) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        if (field.type === "section") {
          return (
            <p key={field.id} className="pt-1 font-serif text-lg">
              {field.label}
            </p>
          );
        }
        if (field.type === "info") {
          return (
            <div key={field.id}>
              <p className="text-sm whitespace-pre-line text-guest-ink">
                {field.label}
              </p>
              {field.description ? (
                <p className="mt-1 text-xs whitespace-pre-line text-guest-ink-soft">
                  {field.description}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-guest-ink">
              {field.label}
              {field.required ? (
                <span aria-hidden style={{ color: accent }}>
                  {" "}
                  *
                </span>
              ) : (
                <span className="font-normal text-guest-ink-soft">
                  {" "}
                  (optional)
                </span>
              )}
            </label>
            {field.description ? (
              <p className="-mt-1 text-xs text-guest-ink-soft">
                {field.description}
              </p>
            ) : null}
            <FieldInput field={field} value={answers[field.id]} accent={accent} onChange={onChange} />
            {errors[field.id] ? (
              <p className="text-xs text-guest-danger">{errors[field.id]}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  field,
  value,
  accent,
  onChange,
}: {
  field: FormField;
  value: FormAnswers[string] | undefined;
  accent: string;
  onChange: (fieldId: string, value: FormAnswers[string] | undefined) => void;
}) {
  const inputClass = `h-12 w-full rounded-xl border ${HAIRLINE_CLASS} bg-white px-4 text-base text-guest-ink outline-none placeholder:text-guest-ink-soft/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-guest-ink/25`;

  switch (field.type) {
    case "long_text":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(field.id, e.target.value)}
          className={`w-full rounded-xl border ${HAIRLINE_CLASS} bg-white px-4 py-3 text-base text-guest-ink outline-none placeholder:text-guest-ink-soft/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-guest-ink/25`}
        />
      );
    case "number":
      return (
        <input
          type="number"
          inputMode="numeric"
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(field.id, e.target.value === "" ? undefined : Number(e.target.value))
          }
          className={inputClass}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          className={inputClass}
        />
      );
    case "yes_no":
      return (
        <div className="flex gap-2">
          {(
            [
              ["Yes", true],
              ["No", false],
            ] as const
          ).map(([label, v]) => (
            <OptionChip
              key={label}
              accent={accent}
              active={value === v}
              onClick={() => onChange(field.id, v)}
            >
              {label}
            </OptionChip>
          ))}
        </div>
      );
    case "rating": {
      const max = field.maxRating ?? 5;
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <OptionChip
              key={n}
              accent={accent}
              active={value === n}
              onClick={() => onChange(field.id, n)}
            >
              {n}
            </OptionChip>
          ))}
        </div>
      );
    }
    case "select":
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <OptionChip
              key={opt.id}
              accent={accent}
              active={value === opt.id}
              onClick={() => onChange(field.id, value === opt.id ? undefined : opt.id)}
            >
              {opt.label}
            </OptionChip>
          ))}
        </div>
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const on = selected.includes(opt.id);
            return (
              <OptionChip
                key={opt.id}
                accent={accent}
                active={on}
                onClick={() =>
                  onChange(
                    field.id,
                    on ? selected.filter((id) => id !== opt.id) : [...selected, opt.id],
                  )
                }
              >
                {opt.label}
              </OptionChip>
            );
          })}
        </div>
      );
    }
    default:
      // short_text / email / phone
      return (
        <input
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.id, e.target.value)}
          className={inputClass}
        />
      );
  }
}

function OptionChip({
  accent,
  active,
  onClick,
  children,
}: {
  accent: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-11 rounded-full border ${HAIRLINE_CLASS} bg-white px-4 text-sm text-guest-ink transition-colors`}
      // The event page's accent is per-bot data — inline style stays for it.
      style={
        active
          ? { borderColor: accent, backgroundColor: `${accent}14`, color: accent }
          : undefined
      }
    >
      {children}
    </button>
  );
}
