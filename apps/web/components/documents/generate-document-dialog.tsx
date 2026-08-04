"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { TintIcon } from "@/components/ui/tint-card";
import { Textarea } from "@/components/ui/textarea";
import { createDocument } from "./actions";
import { setPendingGeneration } from "@/lib/documents/pending-generation";
import {
  documentsQueryOptions,
  documentsTreeQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
};

const EXAMPLES = [
  "Onboarding guide for new front-desk staff",
  "Weekly housekeeping standup template",
  "Incident response runbook for guest complaints",
];

/**
 * "Generate doc from a prompt" entry point (shared by the property Home and the
 * Docs home). Describes the doc in plain language; on submit we create an empty
 * document, stash the prompt for the editor to consume on mount, and navigate
 * to it. The editor fires the doc-bot and shows the draft as a staged AI
 * suggestion the user accepts — reusing the existing review flow, so no content
 * is written server-side.
 */
export function GenerateDocumentDialog({
  open,
  onOpenChange,
  propertyId,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) setPrompt("");
    onOpenChange(next);
  }

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await createDocument(propertyId);
    if ("error" in res) {
      toast.error(res.error);
      setBusy(false);
      return;
    }

    // Seed the tree cache so the editor route doesn't `notFound()` before the
    // realtime patch lands — same guard as CreateDocumentDialog.
    const treeKey = documentsTreeQueryOptions(propertyId).queryKey;
    queryClient.setQueryData<DocumentTreeRow[]>(treeKey, (current) => {
      if (!current) return current;
      if (current.some((d) => d.id === res.id)) return current;
      const placeholder: DocumentTreeRow = {
        id: res.id,
        title: "Untitled document",
        parent_id: null,
        position: Number.MAX_SAFE_INTEGER,
        kind: "doc",
        updated_at: new Date().toISOString(),
        last_edited_by: null,
      };
      return [...current, placeholder];
    });

    setPendingGeneration(res.id, trimmed);
    void queryClient.invalidateQueries({
      queryKey: documentsQueryOptions(propertyId).queryKey,
    });
    setPrompt("");
    setBusy(false);
    onOpenChange(false);
    router.push(`/p/${propertyId}/documents/${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg gap-5">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 pr-6">
          <TintIcon tone="lavender" className="mt-0.5">
            <Sparkles strokeWidth={1.5} />
          </TintIcon>
          <div className="flex flex-col gap-1">
            <DialogTitle>Generate a document</DialogTitle>
            <DialogDescription className="text-pretty">
              Describe what you need — we&apos;ll draft it for you to review and
              edit.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder="e.g. Onboarding guide for new front-desk staff…"
            rows={4}
            disabled={busy}
            className="resize-none"
          />

          <div className="flex flex-col gap-2">
            <p className="text-xs leading-3 font-medium text-faint-foreground">
              Not sure where to start?
            </p>
            <ul role="list" className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPrompt(ex)}
                    className="group inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent-pressed focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-60"
                  >
                    {ex}
                    <ArrowUpRight className="size-3 shrink-0 text-faint-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="hidden items-center gap-1.5 text-xs text-faint-foreground sm:flex">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>⏎</Kbd>
            </KbdGroup>
            to generate
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={busy || !prompt.trim()}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
