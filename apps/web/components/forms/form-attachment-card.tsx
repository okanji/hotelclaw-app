"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { parseFormSchema, type FormSchema } from "@/lib/forms/schema";
import { FormRenderer } from "@/components/forms/form-renderer";
import { submitFormResponse } from "@/components/forms/actions";
import type { FormAttachmentPayload } from "@/components/forms/share-actions";

/**
 * A form shared into chat — compact card with a "Fill out" button that opens
 * the form in a dialog and submits in place (source "chat"). Rendered by
 * SlackAttachment for attachments of type "form".
 */
export function FormAttachmentCard({ attachment }: { attachment: FormAttachmentPayload }) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function openForm() {
    setOpen(true);
    if (schema || done) return;
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("forms")
      .select("schema, status")
      .eq("id", attachment.form_id)
      .maybeSingle();
    if (error || !data) {
      setLoadError("This form is no longer available.");
      return;
    }
    if (data.status !== "published") {
      setLoadError(
        data.status === "closed" ? "This form has been closed." : "This form isn't published.",
      );
      return;
    }
    setSchema(parseFormSchema(data.schema));
  }

  return (
    <>
      <div className="my-1 flex w-fit max-w-sm items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ClipboardList className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{attachment.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {attachment.description ||
              `${attachment.field_count} question${attachment.field_count === 1 ? "" : "s"}`}
          </p>
        </div>
        <Button size="sm" variant={done ? "ghost" : "default"} onClick={openForm} className="shrink-0">
          {done ? (
            <>
              <CheckCircle2 data-slot="icon" className="text-emerald-600" />
              Done
            </>
          ) : (
            "Fill out"
          )}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{attachment.title}</DialogTitle>
            {attachment.description ? (
              <DialogDescription>{attachment.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {done ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="size-8 text-emerald-600" />
              <p className="text-sm font-medium">Response recorded</p>
              <p className="text-xs text-muted-foreground">Thanks — your answers are in.</p>
            </div>
          ) : loadError ? (
            <p className="py-4 text-sm text-muted-foreground">{loadError}</p>
          ) : !schema ? (
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <FormRenderer
              schema={schema}
              compact
              upload={{ propertyId: attachment.property_id, formId: attachment.form_id }}
              propertyId={attachment.property_id}
              onSubmit={async (answers) => {
                const result = await submitFormResponse({
                  formId: attachment.form_id,
                  answers,
                  source: "chat",
                });
                if ("error" in result) return result;
                setDone(true);
                return { ok: true };
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
