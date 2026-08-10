"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Table2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { marked } from "marked";
import { renameDocument } from "./actions";
import { setPendingImport } from "@/lib/documents/pending-generation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * The five ways to put something new in the Directory, in ONE place — used by
 * two presentations that share `useDocumentCreators`:
 *
 *  - `<NewDocumentMenu>` — the toolbar's "New" dropdown. This is the default
 *    affordance once the property has documents, so the toolbar can lead with
 *    search (the actual primary act on a directory).
 *  - `<QuickCreateRow>` — the full tile row, kept for the EMPTY state, where
 *    discoverability beats density and there is no list to search yet.
 *
 * "doc"/"sheet" both live in the `documents` table (`kind`); "form" lives in
 * the separate `forms` table and opens the form builder. "generate" defers to
 * the existing `GenerateDocumentDialog` via `onGenerate`.
 */
type TileId = "doc" | "sheet" | "form" | "generate" | "import";

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
  {
    id: "import",
    label: "Import",
    sub: "Markdown, HTML, text",
    icon: Upload,
    tone: "sage",
  },
];

type ImportKind = "md" | "html" | "txt";

function importKindFor(fileName: string): ImportKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "txt") return "txt";
  return null;
}

/** Title from the file's own structure, falling back to the filename. */
function titleFromImport(fileName: string, kind: ImportKind, raw: string): string {
  if (kind === "md") {
    const m = raw.match(/^#\s+(.+)$/m);
    if (m) return m[1].trim().slice(0, 120);
  }
  if (kind === "html") {
    const m =
      raw.match(/<title[^>]*>([^<]+)<\/title>/i) ??
      raw.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (m) return m[1].trim().slice(0, 120);
  }
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Imported document";
}

/** Convert the picked file's text to editor-ready HTML. */
function htmlFromImport(kind: ImportKind, raw: string): string {
  if (kind === "md") return marked.parse(raw, { async: false }) as string;
  if (kind === "html") {
    // Tiptap's schema-driven parser drops anything it doesn't know; strip the
    // document chrome so we hand it just the body.
    const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return body ? body[1] : raw;
  }
  return raw
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p>${p
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

/**
 * All five create paths, headless. Both presentations call `run(id)`; the
 * import path needs a real `<input type=file>` in the DOM, so the hook hands
 * back the ref + change handler and the caller renders `<ImportFileInput>`.
 */
function useDocumentCreators(propertyId: string, onGenerate: () => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<TileId | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Import: convert the picked file client-side, create + rename the doc,
  // stash the HTML for the editor to set once Yjs is ready, and navigate.
  async function handleImportFile(file: File) {
    const kind = importKindFor(file.name);
    if (!kind) {
      toast.error("Use a .md, .html, or .txt file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That file is too large (2 MB max)");
      return;
    }
    setBusy("import");
    try {
      const raw = await file.text();
      const html = htmlFromImport(kind, raw);
      const title = titleFromImport(file.name, kind, raw);

      const res = await createDocument(propertyId, null, "doc");
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const renamed = await renameDocument(res.id, title);
      if ("error" in renamed) toast.error(renamed.error);

      const treeKey = documentsTreeQueryOptions(propertyId).queryKey;
      queryClient.setQueryData<DocumentTreeRow[]>(treeKey, (current) => {
        if (!current || current.some((d) => d.id === res.id)) return current;
        const placeholder: DocumentTreeRow = {
          id: res.id,
          title,
          parent_id: null,
          position: Number.MAX_SAFE_INTEGER,
          kind: "doc",
          updated_at: new Date().toISOString(),
          last_edited_by: null,
        };
        return [...current, placeholder];
      });

      setPendingImport(res.id, html);
      void queryClient.invalidateQueries({
        queryKey: documentsQueryOptions(propertyId).queryKey,
      });
      router.push(`/p/${propertyId}/documents/${res.id}`);
    } finally {
      setBusy(null);
    }
  }

  const run = useCallback(
    async (id: TileId) => {
      if (busy) return;
      if (id === "generate") {
        onGenerate();
        return;
      }
      if (id === "import") {
        fileInputRef.current?.click();
        return;
      }
      setBusy(id);
      try {
        if (id === "form") await createBlankForm();
        else await createDoc(id);
      } finally {
        setBusy(null);
      }
    },
    // `createDoc`/`createBlankForm` are re-created every render but close over
    // nothing that changes identity meaningfully; the deps that matter are the
    // busy latch and the generate callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, onGenerate],
  );

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleImportFile(file);
  }

  return { busy, run, fileInputRef, onFileChange };
}

/** The hidden picker the "Import" path clicks. Render one per creator hook. */
function ImportFileInput({
  inputRef,
  onChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".md,.markdown,.html,.htm,.txt"
      className="hidden"
      onChange={onChange}
    />
  );
}

/**
 * Toolbar "New" dropdown — the dense presentation of the same five paths.
 * Import is separated by a rule because it consumes something the user already
 * has rather than producing something blank.
 */
export function NewDocumentMenu({
  propertyId,
  onGenerate,
}: {
  propertyId: string;
  onGenerate: () => void;
}) {
  const { busy, run, fileInputRef, onFileChange } = useDocumentCreators(
    propertyId,
    onGenerate,
  );

  return (
    <>
      <ImportFileInput inputRef={fileInputRef} onChange={onFileChange} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" disabled={busy !== null} />}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Plus />
          )}
          New
          <ChevronDown className="opacity-70" />
        </DropdownMenuTrigger>
        {/* Wide enough that the trailing hint never wraps — at `min-w-52` the
            two-word labels and the hints collided mid-item. */}
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-72">
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <span key={t.id} className="contents">
                {t.id === "import" ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => void run(t.id)}>
                  <Icon strokeWidth={1.5} className="text-faint-foreground" />
                  <span className="flex-1 whitespace-nowrap">{t.label}</span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-faint-foreground">
                    {t.sub}
                  </span>
                </DropdownMenuItem>
              </span>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Tile row — the discoverable presentation, used on the empty Directory where
 * there is nothing to search and the question is "what can I even make here?".
 */
export function QuickCreateRow({
  propertyId,
  onGenerate,
}: {
  propertyId: string;
  onGenerate: () => void;
}) {
  const { busy, run, fileInputRef, onFileChange } = useDocumentCreators(
    propertyId,
    onGenerate,
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <ImportFileInput inputRef={fileInputRef} onChange={onFileChange} />
      {TILES.map((t) => {
        const Icon = t.icon;
        const isBusy = busy === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(t.id)}
            aria-label={
              t.id === "generate" ? "Generate a document with AI" : `Create ${t.label.toLowerCase()}`
            }
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-card bg-card p-3 text-left shadow-card transition-colors",
              "hover:bg-accent",
              "focus-visible:outline-none focus-visible:shadow-focus",
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
              <div className="text-sm font-medium text-foreground">
                {t.label}
              </div>
              <div className="truncate text-xs text-faint-foreground">
                {t.sub}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
