"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormRenderer } from "./form-renderer";
import { submitFormResponse } from "./actions";
import { parseFormSchema, type FormAnswers } from "@/lib/forms/schema";
import type { FormStatus } from "@/lib/db/types";

/**
 * Centered fill view for the shared form link — branded header (icon tile,
 * big title, lead description) over the roomy page-mode renderer.
 * Validation runs in the renderer client-side and again in
 * `submitFormResponse` server-side; field errors land back untouched.
 */
export function FormFill({
  propertyId,
  formId,
  title,
  description,
  icon,
  schema: rawSchema,
  status,
  allowMultiple,
}: {
  propertyId: string;
  formId: string;
  title: string;
  description: string | null;
  icon: string | null;
  schema: unknown;
  status: FormStatus;
  allowMultiple: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);
  const schema = parseFormSchema(rawSchema);

  async function submit(answers: FormAnswers) {
    const result = await submitFormResponse({ formId, answers, source: "direct" });
    if ("error" in result) return result;
    setSubmitted(true);
    return { ok: true as const };
  }

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 py-12 sm:py-16">
      <div className="w-full max-w-2xl">
        <header className="flex flex-col items-start gap-5">
          <div className="flex size-16 items-center justify-center rounded-md bg-muted text-4xl">
            {icon || <ClipboardList className="size-7 text-muted-foreground" />}
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold text-balance">
              {title}
            </h1>
            {description ? (
              <p className="max-w-prose text-base leading-relaxed text-pretty text-foreground/80">
                {description}
              </p>
            ) : null}
          </div>
        </header>

        <div className="mt-10">
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              <p className="text-sm font-medium">Response recorded</p>
              <p className="text-sm text-muted-foreground">
                Thanks — your answers have been submitted.
              </p>
              {allowMultiple ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setSubmitted(false)}
                >
                  Submit another response
                </Button>
              ) : null}
            </div>
          ) : status !== "published" ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <ClipboardList className="size-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                {status === "closed"
                  ? "This form is closed"
                  : "This form isn't published yet"}
              </p>
              <p className="max-w-[36ch] text-sm text-pretty text-muted-foreground">
                {status === "closed"
                  ? "It's no longer accepting responses."
                  : "Ask whoever shared it to publish it first."}
              </p>
            </div>
          ) : schema.fields.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              This form has no fields yet.
            </p>
          ) : (
            <FormRenderer
              schema={schema}
              onSubmit={submit}
              mode="page"
              upload={{ propertyId, formId }}
              propertyId={propertyId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
