"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ClipboardList,
  FileText,
  Loader2,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { TintIcon, type TintTone } from "@/components/ui/tint-card";
import { cn } from "@/lib/utils";
import { createDocument } from "./actions";
import { createForm } from "@/components/forms/actions";
import {
  documentsQueryOptions,
  documentsTreeQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";

/**
 * Quick-create tile row for the Docs home — one tile per creatable type
 * (Document, Spreadsheet, Form) plus an AI generate shortcut. Mirrors the
 * house `QuickAccessRow` language (neutral card, subtle border, colour only in
 * the tinted icon chip). A single click creates and navigates; while a create
 * is in flight its tile spins and the rest are disabled.
 *
 * "doc"/"sheet" both live in the `documents` table (`kind`); "form" lives in
 * the separate `forms` table and opens the form builder. "generate" defers to
 * the existing `GenerateDocumentDialog` via `onGenerate`.
 */
type TileId = "doc" | "sheet" | "form" | "generate";

type Tile = {
  id: TileId;
  label: string;
  sub: string;
  icon: LucideIcon;
  tone: TintTone;
};

const TILES: Tile[] = [
  {
    id: "doc",
    label: "Document",
    sub: "Rich text & sub-pages",
    icon: FileText,
    tone: "lavender",
  },
  {
    id: "sheet",
    label: "Spreadsheet",
    sub: "Cells & formulas",
    icon: Table2,
    tone: "blue",
  },
  {
    id: "form",
    label: "Form",
    sub: "Questions & responses",
    icon: ClipboardList,
    tone: "honey",
  },
  {
    id: "generate",
    label: "Generate",
    sub: "Draft with AI",
    icon: Sparkles,
    tone: "coral",
  },
];

export function QuickCreateRow({
  propertyId,
  onGenerate,
}: {
  propertyId: string;
  onGenerate: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<TileId | null>(null);

  async function createDoc(kind: "doc" | "sheet") {
    const res = await createDocument(propertyId, null, kind);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }

    // Optimistically seed the tree query so the editor route doesn't
    // `notFound()` while the postgres_changes patch flies back — same guard
    // the CreateDocumentDialog uses.
    const treeKey = documentsTreeQueryOptions(propertyId).queryKey;
    queryClient.setQueryData<DocumentTreeRow[]>(treeKey, (current) => {
      if (!current || current.some((d) => d.id === res.id)) return current;
      const placeholder: DocumentTreeRow = {
        id: res.id,
        title: kind === "sheet" ? "Untitled spreadsheet" : "Untitled document",
        parent_id: null,
        position: Number.MAX_SAFE_INTEGER,
        kind,
        updated_at: new Date().toISOString(),
        last_edited_by: null,
      };
      return [...current, placeholder];
    });

    void queryClient.invalidateQueries({
      queryKey: documentsQueryOptions(propertyId).queryKey,
    });
    router.push(`/p/${propertyId}/documents/${res.id}`);
  }

  async function createBlankForm() {
    const res = await createForm({ propertyId, title: "Untitled form" });
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    router.push(`/p/${propertyId}/forms/${res.formId}`);
  }

  async function handle(id: TileId) {
    if (busy) return;
    if (id === "generate") {
      onGenerate();
      return;
    }
    setBusy(id);
    try {
      if (id === "form") await createBlankForm();
      else await createDoc(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => {
        const Icon = t.icon;
        const isBusy = busy === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void handle(t.id)}
            aria-label={
              t.id === "generate" ? "Generate a document with AI" : `Create ${t.label.toLowerCase()}`
            }
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors",
              "hover:border-foreground/20 hover:bg-muted/20",
              "focus-visible:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <TintIcon tone={t.tone}>
              {isBusy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Icon strokeWidth={1.5} />
              )}
            </TintIcon>
            <div className="min-w-0">
              <div className="font-medium text-foreground">{t.label}</div>
              <div className="truncate text-sm text-muted-foreground">
                {t.sub}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
