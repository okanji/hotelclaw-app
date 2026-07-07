"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  inputFields,
  validateFieldAnswer,
  MAX_FILES_PER_FIELD,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormFieldOption,
  type FormFieldSource,
  type FormFileValue,
  type FormSchema,
} from "@/lib/forms/schema";

/**
 * Live options for a data-connected choice field, fetched from the forms
 * options API and memoized per (property, source) for the session. Plain
 * fetch + module cache (not react-query) so the renderer stays usable in
 * provider-less surfaces like the onboarding wizard.
 */
const sourcedOptionsCache = new Map<string, FormFieldOption[]>();

function useSourcedOptions(
  propertyId: string | undefined,
  source: FormFieldSource | undefined,
): { options: FormFieldOption[]; loading: boolean } {
  const key =
    propertyId && source ? `${propertyId}:${JSON.stringify(source)}` : null;

  // "Adjust state when a value changes" pattern — the cached/initial state
  // for a new key is derived during render, so the effect only ever does
  // the actual network fetch.
  const [state, setState] = useState<{
    key: string | null;
    options: FormFieldOption[];
    loading: boolean;
  }>(() => ({
    key,
    options: key ? (sourcedOptionsCache.get(key) ?? []) : [],
    loading: !!key && !sourcedOptionsCache.has(key),
  }));
  if (state.key !== key) {
    setState({
      key,
      options: key ? (sourcedOptionsCache.get(key) ?? []) : [],
      loading: !!key && !sourcedOptionsCache.has(key),
    });
  }

  useEffect(() => {
    if (!key || !propertyId || !source || sourcedOptionsCache.has(key)) return;
    let cancelled = false;
    const params = new URLSearchParams({ kind: source.kind });
    if (source.documentId) params.set("documentId", source.documentId);
    if (source.column) params.set("column", source.column);
    fetch(`/api/properties/${propertyId}/forms/options?${params}`)
      .then(async (res) => {
        const json = (await res.json()) as { options?: FormFieldOption[] };
        const opts = Array.isArray(json.options) ? json.options : [];
        sourcedOptionsCache.set(key, opts);
        if (!cancelled) setState({ key, options: opts, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ key, options: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [key, propertyId, source]);

  return { options: state.options, loading: state.loading };
}

/**
 * Renders a FormSchema. One renderer for every surface that shows a form —
 * the Forms section, chat embeds, the builder preview, and (via
 * `FormFieldInput`) the onboarding wizard — so a form always looks and
 * validates the same wherever it appears.
 *
 * `mode="page"` is the classic stacked layout (ClickUp-style: generous
 * spacing, semibold labels, dropdown selects, roomy inputs);
 * `mode="wizard"` is one-question-per-screen with Enter-to-advance, in the
 * Typeform/Claude onboarding style.
 */

export type FormSubmitResult =
  | { ok: true }
  | { error: string; fieldErrors?: Record<string, string> };

/** Where the Attachment field uploads to — see /forms/[formId]/upload. */
export type FormUploadTarget = { propertyId: string; formId: string };

type Props = {
  schema: FormSchema;
  onSubmit: (answers: FormAnswers) => Promise<FormSubmitResult>;
  mode?: "page" | "wizard";
  submitLabel?: string;
  /** Compact spacing for embedding inside a chat card or dialog. */
  compact?: boolean;
  disabled?: boolean;
  /** Required for "file" fields to accept uploads; omitted → dropzone disabled. */
  upload?: FormUploadTarget;
  /** Required for data-connected choice fields to resolve their live options. */
  propertyId?: string;
};

export function FormRenderer({
  schema,
  onSubmit,
  mode = "page",
  submitLabel = "Submit",
  compact = false,
  disabled = false,
  upload,
  propertyId,
}: Props) {
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const fields = schema.fields;
  const answerable = useMemo(() => inputFields(schema), [schema]);

  function setAnswer(fieldId: string, value: FormAnswerValue) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function validateAll(): boolean {
    const next: Record<string, string> = {};
    for (const field of answerable) {
      const error = validateFieldAnswer(field, answers[field.id]);
      if (error) next[field.id] = error;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validateAll()) return;
    startTransition(async () => {
      const result = await onSubmit(answers);
      if ("error" in result) {
        setFormError(result.error);
        if (result.fieldErrors) setErrors(result.fieldErrors);
      }
    });
  }

  if (mode === "wizard") {
    return (
      <WizardRenderer
        fields={fields}
        answers={answers}
        errors={errors}
        formError={formError}
        busy={busy || disabled}
        submitLabel={submitLabel}
        setAnswer={setAnswer}
        onFinish={submit}
        upload={upload}
        propertyId={propertyId}
      />
    );
  }

  // Page mode: roomy ClickUp-style unless embedded compactly.
  const roomy = !compact;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn("flex flex-col", roomy ? "gap-8" : "gap-4")}
    >
      {fields.map((field) =>
        field.type === "section" ? (
          <div key={field.id} className={cn(roomy ? "pt-2" : "pt-1")}>
            <h3 className={cn("font-semibold", roomy ? "text-base" : "text-sm")}>
              {field.label}
            </h3>
            {field.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{field.description}</p>
            ) : null}
          </div>
        ) : (
          <div key={field.id} className={cn("space-y-2", !roomy && "space-y-1.5")}>
            <Label
              htmlFor={`ff-${field.id}`}
              className={cn("gap-0.5", roomy ? "text-base font-semibold" : "text-sm")}
            >
              {field.label}
              {field.required ? <span className="text-destructive">*</span> : null}
            </Label>
            {field.description ? (
              <p className="text-sm text-muted-foreground">{field.description}</p>
            ) : null}
            <FormFieldInput
              field={field}
              value={answers[field.id]}
              onChange={(v) => setAnswer(field.id, v)}
              disabled={busy || disabled}
              inputId={`ff-${field.id}`}
              large={roomy}
              upload={upload}
              propertyId={propertyId}
            />
            {errors[field.id] ? (
              <p className="text-xs text-destructive">{errors[field.id]}</p>
            ) : null}
          </div>
        ),
      )}
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      <div className={cn(roomy && "pt-2")}>
        <Button type="submit" disabled={busy || disabled} size={roomy ? "lg" : "default"}>
          {busy ? "Submitting…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * One-question-per-screen flow. Sections render as full-screen interstitial
 * headings; Enter advances (Shift+Enter for newlines in long answers).
 */
function WizardRenderer({
  fields,
  answers,
  errors,
  formError,
  busy,
  submitLabel,
  setAnswer,
  onFinish,
  upload,
  propertyId,
}: {
  fields: FormField[];
  answers: FormAnswers;
  errors: Record<string, string>;
  formError: string | null;
  busy: boolean;
  submitLabel: string;
  setAnswer: (fieldId: string, value: FormAnswerValue) => void;
  onFinish: () => void;
  upload?: FormUploadTarget;
  propertyId?: string;
}) {
  const [index, setIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  if (fields.length === 0) return null;
  const field = fields[Math.min(index, fields.length - 1)];
  const last = index >= fields.length - 1;
  const progress = ((index + 1) / fields.length) * 100;

  function advance() {
    setStepError(null);
    if (field.type !== "section") {
      const error = validateFieldAnswer(field, answers[field.id]);
      if (error) {
        setStepError(error);
        return;
      }
    }
    if (last) {
      onFinish();
    } else {
      setIndex((i) => i + 1);
    }
  }

  const error = stepError ?? errors[field.id] ?? null;

  return (
    <div
      className="flex min-h-72 flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        const el = e.target as HTMLElement | null;
        if (el?.tagName === "TEXTAREA") return;
        e.preventDefault();
        advance();
      }}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* key remounts the step so the enter animation replays per question */}
      <div key={field.id} className="flex flex-1 flex-col justify-center gap-4 py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {index + 1} of {fields.length}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-balance">
            {field.label}
            {field.required && field.type !== "section" ? (
              <span className="text-destructive"> *</span>
            ) : null}
          </h2>
          {field.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{field.description}</p>
          ) : null}
        </div>

        {field.type !== "section" ? (
          <FormFieldInput
            field={field}
            value={answers[field.id]}
            onChange={(v) => setAnswer(field.id, v)}
            disabled={busy}
            autoFocus
            large
            chips
            upload={upload}
            propertyId={propertyId}
          />
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {formError && last ? <p className="text-sm text-destructive">{formError}</p> : null}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setStepError(null);
            setIndex((i) => Math.max(0, i - 1));
          }}
          disabled={index === 0 || busy}
        >
          <ArrowLeft data-slot="icon" />
          Back
        </Button>
        <Button type="button" onClick={advance} disabled={busy}>
          {busy ? "Submitting…" : last ? submitLabel : "Next"}
          {!busy && !last ? <ArrowRight data-slot="icon" /> : null}
        </Button>
      </div>
    </div>
  );
}

/**
 * The input control for a single field — exported so surfaces with their own
 * step chrome (the onboarding wizard) can reuse the exact same controls.
 *
 * Single-choice fields render as a dropdown by default (ClickUp-style);
 * pass `chips` for the wizard's chip style.
 */
export function FormFieldInput({
  field,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  large = false,
  chips = false,
  inputId,
  upload,
  propertyId,
}: {
  field: FormField;
  value: FormAnswerValue | undefined;
  onChange: (value: FormAnswerValue) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Larger touch targets for page / wizard screens. */
  large?: boolean;
  /** Chip-style single choice (wizard); default is a dropdown. */
  chips?: boolean;
  inputId?: string;
  upload?: FormUploadTarget;
  /** Needed to resolve a data-connected field's live options. */
  propertyId?: string;
}) {
  // Data-connected fields resolve options live; static fields use the
  // hand-typed list. The hook no-ops when the field has no source.
  const sourced = useSourcedOptions(propertyId, field.source);
  const options = field.source ? sourced.options : (field.options ?? []);
  const optionsLoading = !!field.source && sourced.loading;

  switch (field.type) {
    case "short_text":
    case "email":
    case "phone":
      return (
        <Input
          id={inputId}
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn(large && "h-11 rounded-lg px-3.5 text-base")}
        />
      );
    case "long_text":
      return (
        <Textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          rows={large ? 4 : 3}
          className={cn(large && "rounded-lg px-3.5 py-3 text-base")}
        />
      );
    case "number":
      return (
        <Input
          id={inputId}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn(large && "h-11 rounded-lg px-3.5 text-base")}
        />
      );
    case "date":
      return (
        <div className="relative w-fit">
          <CalendarDays
            className={cn(
              "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground",
              large ? "size-4" : "size-3.5",
            )}
          />
          <Input
            id={inputId}
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            autoFocus={autoFocus}
            className={cn("pl-9", large && "h-11 rounded-lg text-base")}
          />
        </div>
      );
    case "select": {
      if (chips) {
        return (
          <ChoiceChips
            options={options}
            selected={typeof value === "string" ? [value] : []}
            onToggle={(id) => onChange(value === id ? null : id)}
            disabled={disabled}
            large={large}
          />
        );
      }
      const empty = typeof value !== "string" || value === "";
      return (
        <div className="relative">
          <select
            id={inputId}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled || optionsLoading}
            className={cn(
              "w-full cursor-pointer appearance-none rounded-lg border border-input bg-transparent pr-9 shadow-xs transition-colors outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20",
              "disabled:pointer-events-none disabled:opacity-50",
              large ? "h-11 px-3.5 text-base" : "h-8 px-2.5 text-sm",
              empty && "text-muted-foreground",
            )}
          >
            <option value="">
              {optionsLoading ? "Loading options…" : field.placeholder || "Select option…"}
            </option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className={cn(
              "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground",
              large ? "size-4" : "size-3.5",
            )}
          />
        </div>
      );
    }
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      if (optionsLoading) {
        return <p className="text-sm text-muted-foreground">Loading options…</p>;
      }
      return (
        <ChoiceChips
          options={options}
          selected={selected}
          onToggle={(id) =>
            onChange(
              selected.includes(id)
                ? selected.filter((v) => v !== id)
                : [...selected, id],
            )
          }
          disabled={disabled}
          large={large}
        />
      );
    }
    case "yes_no":
      return (
        <ChoiceChips
          options={[
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ]}
          selected={value === true ? ["yes"] : value === false ? ["no"] : []}
          onToggle={(id) => onChange(value === (id === "yes") ? null : id === "yes")}
          disabled={disabled}
          large={large}
        />
      );
    case "rating": {
      const max = field.maxRating ?? 5;
      const current = typeof value === "number" ? value : 0;
      return (
        <div className="flex items-center gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(current === n ? null : n)}
              aria-label={`${n} of ${max}`}
              className={cn(
                "rounded-md p-1 transition-colors hover:bg-accent disabled:pointer-events-none",
                large && "p-1.5",
              )}
            >
              <Star
                className={cn(
                  large ? "size-7" : "size-5",
                  n <= current
                    ? "fill-amber-400 stroke-amber-400"
                    : "stroke-muted-foreground/50",
                )}
              />
            </button>
          ))}
        </div>
      );
    }
    case "file":
      return (
        <FileDropzone
          value={Array.isArray(value) ? (value as FormFileValue[]) : []}
          onChange={onChange}
          disabled={disabled}
          large={large}
          upload={upload}
        />
      );
    case "section":
      return null;
  }
}

/**
 * ClickUp-style attachment dropzone — dashed border, drop or click to
 * upload. Files go to the form-uploads bucket via the form's upload route;
 * the answer value is the uploaded file list.
 */
function FileDropzone({
  value,
  onChange,
  disabled,
  large,
  upload,
}: {
  value: FormFileValue[];
  onChange: (value: FormAnswerValue) => void;
  disabled?: boolean;
  large?: boolean;
  upload?: FormUploadTarget;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = !!upload && !disabled;

  async function uploadFiles(files: FileList | File[]) {
    if (!upload) return;
    setError(null);
    setUploading(true);
    const next = [...value];
    try {
      for (const file of Array.from(files)) {
        if (next.length >= MAX_FILES_PER_FIELD) {
          setError(`At most ${MAX_FILES_PER_FIELD} files`);
          break;
        }
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(
          `/api/properties/${upload.propertyId}/forms/${upload.formId}/upload`,
          { method: "POST", body },
        );
        const json = (await res.json()) as
          | { url: string; path: string; name: string; size: number; type: string }
          | { error: string };
        if (!res.ok || "error" in json) {
          setError("error" in json ? json.error : "Upload failed");
          continue;
        }
        next.push(json);
      }
      onChange(next);
    } finally {
      setUploading(false);
    }
  }

  function removeAt(index: number) {
    const next = value.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : null);
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={canUpload ? 0 : -1}
        aria-disabled={!canUpload}
        onClick={() => canUpload && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (canUpload && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full items-center justify-center rounded-lg border border-dashed text-center transition-colors",
          large ? "px-4 py-8" : "px-3 py-5",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input hover:border-muted-foreground/40",
          !canUpload && "cursor-not-allowed opacity-60",
          canUpload && "cursor-pointer",
        )}
      >
        {uploading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Uploading…
          </span>
        ) : (
          <span className={cn("text-muted-foreground", large ? "text-base" : "text-sm")}>
            Drop your files here to{" "}
            <span className="font-medium text-foreground underline underline-offset-2">
              upload
            </span>
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          disabled={!canUpload}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void uploadFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />
      </div>

      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((file, i) => (
            <li
              key={`${file.url}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              {typeof file.size === "number" ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
              ) : null}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeAt(i)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!upload && !disabled ? (
        <p className="text-xs text-muted-foreground">Uploads aren’t available here.</p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ChoiceChips({
  options,
  selected,
  onToggle,
  disabled,
  large,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  large?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(opt.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
              large && "px-4 py-2 text-base",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {active ? <Check className={cn("size-3.5", large && "size-4")} /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
