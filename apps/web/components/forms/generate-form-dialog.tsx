"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createForm } from "./actions";

const EXAMPLES = [
  "Guest complaint intake with room number, category, severity and photos-needed yes/no",
  "End-of-shift kitchen closing checklist",
  "Anonymous staff satisfaction survey with ratings",
  "Banquet event request: date, headcount, dietary needs",
];

/** Describe-a-form dialog — POSTs the prompt to the AI generation endpoint,
 *  creates the form from the returned schema, and lands in the builder. */
export function GenerateFormDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();

  function generate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/forms/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed }),
        });
        const body = (await res.json()) as {
          error?: string;
          title?: string;
          description?: string | null;
          schema?: unknown;
        };
        if (!res.ok || body.error || !body.title || !body.schema) {
          toast.error(body.error ?? "Generation failed");
          return;
        }
        const created = await createForm({
          propertyId,
          title: body.title,
          description: body.description ?? null,
          schema: body.schema,
        });
        if ("error" in created) {
          toast.error(created.error);
          return;
        }
        setPrompt("");
        onOpenChange(false);
        toast.success("Form drafted — review and publish when ready");
        router.push(`/p/${propertyId}/forms/${created.formId}`);
      } catch {
        toast.error("Generation failed — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a form with AI</DialogTitle>
          <DialogDescription>
            Describe what you need to collect and AI drafts the fields. You
            can edit everything in the builder before publishing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={generate} className="space-y-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the form… e.g. 'Guest complaint intake with room number, category, severity and photos-needed yes/no'"
            rows={4}
            disabled={pending}
            autoFocus
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={pending}
                onClick={() => setPrompt(example)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !prompt.trim()}>
              {pending ? (
                <Loader2 data-slot="icon" className="animate-spin" />
              ) : (
                <Sparkles data-slot="icon" />
              )}
              {pending ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
