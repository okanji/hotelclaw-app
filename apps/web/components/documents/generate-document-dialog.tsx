"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium tracking-tight">
            <Sparkles className="size-4 text-violet-500" />
            Generate a document
          </DialogTitle>
          <DialogDescription className="text-sm tracking-tight text-muted-foreground">
            Describe what you need. We&apos;ll draft it for you to review and
            edit.
          </DialogDescription>
        </DialogHeader>

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

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs tracking-tight text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-60"
            >
              {ex}
            </button>
          ))}
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
