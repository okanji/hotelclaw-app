"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { diffText, type DiffRow } from "@/lib/documents/text-diff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { restoreAiRevision } from "./revision-actions";

/**
 * The AI revision stash (document_ai_revisions, 0094) finally gets a face.
 * Every AI replace of a non-trivial body stashes the prior snapshot; until
 * now those rows were reachable only through the bot's own restore tool.
 * This panel lists them, shows a CodeBlock-style unified diff against the
 * CURRENT body (line rows with word-level highlights — Beautiful UI's
 * CodeBlock diff anatomy, beautifului.dev, MIT), and restores one — which
 * is itself undoable, because writeDocumentBody stashes before replacing.
 *
 * Members can read the stash directly (0094 grants member SELECT via RLS);
 * the restore runs through the server action.
 */

type RevisionRow = {
  id: string;
  note: string | null;
  replaced_at: string;
  body_text: string;
};

export function AiRevisionsPanel({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["doc-ai-revisions", documentId],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: revisions }, { data: doc }] = await Promise.all([
        supabase
          .from("document_ai_revisions")
          .select("id, note, replaced_at, body_text")
          .eq("document_id", documentId)
          .order("replaced_at", { ascending: false }),
        supabase
          .from("documents")
          .select("body_text")
          .eq("id", documentId)
          .maybeSingle(),
      ]);
      return {
        revisions: (revisions ?? []) as RevisionRow[],
        currentText: doc?.body_text ?? "",
      };
    },
  });

  const revisions = data?.revisions ?? [];
  const selected =
    revisions.find((r) => r.id === selectedId) ?? revisions[0] ?? null;

  const diff = useMemo(() => {
    if (!selected || data === undefined) return null;
    return diffText(selected.body_text, data.currentText);
  }, [selected, data]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading AI edits…
      </div>
    );
  }
  if (revisions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <History className="mb-1 size-5 text-faint-foreground" aria-hidden />
        <p className="text-sm font-medium">No AI rewrites stashed</p>
        <p className="text-sm text-muted-foreground">
          When the AI replaces this document&apos;s body, the previous version
          is kept here — the newest ten.
        </p>
      </div>
    );
  }

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      const result = await restoreAiRevision({
        propertyId,
        documentId,
        revisionId: selected.id,
      });
      if (!result.ok) throw new Error(result.error);
      toast.success(
        "Version restored — the body it replaced was stashed here too.",
      );
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["doc-ai-revisions", documentId] });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't restore that version",
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
        <ul role="list" className="flex flex-col gap-0.5">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(revision.id);
                  setConfirming(false);
                }}
                className={cn(
                  "flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors",
                  selected?.id === revision.id ? "bg-muted" : "hover:bg-accent",
                )}
              >
                <span className="text-sm font-medium">
                  {new Date(revision.replaced_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="truncate text-xs text-faint-foreground">
                  {revision.note ?? "Pre-replace snapshot"} ·{" "}
                  {Math.round(revision.body_text.length / 100) / 10}k chars
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {diff?.changed
              ? "Differences against the current body"
              : "Identical to the current body"}
          </p>
          {confirming ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={restoring}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={restoring}
                onClick={() => void restore()}
              >
                {restoring ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Undo2 className="size-3.5" />
                )}
                Replace current body
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected || !diff?.changed}
              onClick={() => setConfirming(true)}
            >
              <Undo2 className="size-3.5" />
              Restore this version
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {diff?.tooLarge ? (
            <p className="text-sm text-muted-foreground">
              This version is too large to diff — restore it to view it in the
              document.
            </p>
          ) : diff && !diff.changed ? (
            <p className="text-sm text-muted-foreground">
              Nothing changed between this snapshot and the current body.
            </p>
          ) : diff ? (
            <DiffView rows={diff.rows} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** CodeBlock-style unified diff: gutter line numbers, tinted rows with a
 *  2px accent bar, word-level highlights on paired changed lines. */
function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md bg-muted py-1 font-mono text-xs leading-5">
      {rows.map((row, index) => {
        if (row.kind === "skip") {
          return (
            <div
              key={index}
              className="px-3 py-1 text-center text-faint-foreground select-none"
            >
              ⋯ {row.count} unchanged lines
            </div>
          );
        }
        const gutter =
          row.kind === "same"
            ? `${row.oldLine}`
            : row.kind === "del"
              ? `${row.oldLine}`
              : `${row.newLine}`;
        return (
          <div
            key={index}
            className={cn(
              "flex border-l-2 whitespace-pre-wrap",
              row.kind === "same" && "border-transparent",
              row.kind === "del" &&
                "border-destructive/60 bg-diff-delete-bg text-diff-delete-ink",
              row.kind === "add" &&
                "border-success/60 bg-diff-insert-bg text-diff-insert-ink",
            )}
          >
            <span className="w-10 shrink-0 pr-2 text-right text-faint-foreground select-none">
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
              {gutter}
            </span>
            <span className="min-w-0 flex-1 pr-3">
              {"segments" in row && row.segments
                ? row.segments.map((seg, si) => (
                    <span
                      key={si}
                      className={cn(
                        seg.changed &&
                          (row.kind === "del"
                            ? "rounded-[2px] bg-destructive/15"
                            : "rounded-[2px] bg-success/20"),
                      )}
                    >
                      {seg.text}
                    </span>
                  ))
                : row.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
