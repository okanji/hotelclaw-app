"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, Table2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { TintIcon } from "@/components/ui/tint-card";
import { cn } from "@/lib/utils";
import { createDocument, type DocumentKind } from "./actions";
import {
  documentsQueryOptions,
  documentsTreeQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** Pre-fill a parent — used by the sidebar's "Add sub-page" path. */
  parentId?: string | null;
  /** Optional override for what happens after creation — defaults to nav. */
  onCreated?: (id: string, kind: DocumentKind) => void;
};

type Kind = {
  id: DocumentKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  hint: string;
  /** Single-key shortcut while the dialog is open. */
  shortcut: "d" | "s";
};

const KINDS: Kind[] = [
  {
    id: "doc",
    title: "Document",
    description: "Rich text with headings, lists, embeds, and sub-pages.",
    icon: <FileText strokeWidth={1.5} />,
    hint: "Notion-style page",
    shortcut: "d",
  },
  {
    id: "sheet",
    title: "Spreadsheet",
    description: "Cells with formulas, sortable rows, live collaboration.",
    icon: <Table2 strokeWidth={1.5} />,
    hint: "Tables & formulas",
    shortcut: "s",
  },
];

/**
 * Create-new-document picker. Two type tiles (Document / Spreadsheet) inside
 * a compact dialog — single click creates and navigates. Press `D` or `S`
 * while the dialog is open to pick by keyboard.
 */
export function CreateDocumentDialog({
  open,
  onOpenChange,
  propertyId,
  parentId = null,
  onCreated,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<DocumentKind | null>(null);

  // Wrap onOpenChange so we can reset the spinner when the dialog closes
  // without firing a setState inside an effect.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setCreating(null);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Keyboard shortcuts — only when the dialog is open and nothing else is
  // capturing keys. Matches Notion / Linear's "D" / "S" affordance.
  const firstTileRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      const match = KINDS.find((k) => k.shortcut === key);
      if (!match) return;
      e.preventDefault();
      void handlePick(match.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handlePick(kind: DocumentKind) {
    if (creating) return;
    setCreating(kind);
    const res = await createDocument(propertyId, parentId, kind);
    if ("error" in res) {
      toast.error(res.error);
      setCreating(null);
      return;
    }

    // Optimistically seed the tree query so the editor route doesn't
    // `notFound()` while the postgres_changes patch flies back. Mirrors the
    // pattern in `documents-tree-section.tsx`'s onCreate.
    const treeKey = documentsTreeQueryOptions(propertyId).queryKey;
    queryClient.setQueryData<DocumentTreeRow[]>(treeKey, (current) => {
      if (!current) return current;
      const exists = current.some((d) => d.id === res.id);
      if (exists) return current;
      const placeholder: DocumentTreeRow = {
        id: res.id,
        title: kind === "sheet" ? "Untitled spreadsheet" : "Untitled document",
        parent_id: parentId ?? null,
        position: Number.MAX_SAFE_INTEGER,
        kind,
        updated_at: new Date().toISOString(),
        last_edited_by: null,
      };
      return [...current, placeholder];
    });

    handleOpenChange(false);
    if (onCreated) {
      onCreated(res.id, kind);
    } else {
      // Invalidate the home list so the new row shows up when the user
      // comes back from the editor (and on the documents home if it's
      // currently rendered).
      void queryClient.invalidateQueries({
        queryKey: documentsQueryOptions(propertyId).queryKey,
      });
      router.push(`/p/${propertyId}/documents/${res.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border/70 px-4 py-3">
          <DialogTitle className="text-base font-medium tracking-tight">
            New {parentId ? "sub-page" : "document"}
          </DialogTitle>
          <DialogDescription className="text-sm tracking-tight text-muted-foreground">
            Pick a type to get started.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 p-3">
          {KINDS.map((kind, i) => {
            const isCreating = creating === kind.id;
            return (
              <button
                key={kind.id}
                ref={i === 0 ? firstTileRef : undefined}
                type="button"
                disabled={creating !== null}
                onClick={() => void handlePick(kind.id)}
                aria-label={`Create ${kind.title.toLowerCase()}`}
                className={cn(
                  "group relative flex flex-col items-start gap-3 rounded-md border border-border/70 bg-card p-4 text-left shadow-xs transition-all",
                  "hover:border-foreground/15 hover:shadow-sm",
                  "focus-visible:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <TintIcon tone="lavender">
                    {isCreating ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      kind.icon
                    )}
                  </TintIcon>
                  <Kbd aria-hidden>{kind.shortcut.toUpperCase()}</Kbd>
                </div>
                <div className="flex w-full flex-col gap-1">
                  <p className="text-sm font-semibold tracking-tight text-foreground">
                    {kind.title}
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed tracking-tight text-muted-foreground">
                    {kind.description}
                  </p>
                </div>
                <span className="text-xs tracking-tight text-muted-foreground/70">
                  {kind.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-border/70 px-4 py-2.5 text-xs tracking-tight text-muted-foreground">
          Tip: press <Kbd>D</Kbd> or <Kbd>S</Kbd> to pick without leaving the
          keyboard.
        </div>
      </DialogContent>
    </Dialog>
  );
}
