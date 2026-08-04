"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClipboardList, X } from "lucide-react";
import type { EntityColor } from "@/lib/db/types";
import type { DocumentListItem } from "@/lib/documents/queries";
import { cn } from "@/lib/utils";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
  AddPinTile,
  DocPinCard,
  DocumentPinPicker,
  MAX_PINNED_RESOURCES,
  type DocPinCardData,
} from "@/components/documents/doc-pin-card";

const ACCENT_DOT = LABEL_DOT;

type PinCandidate = { id: string; title: string };

/**
 * Space overview resources — same page-thumbnail cards as docs-home boards,
 * but documents are added via search/picker instead of drag-and-drop.
 */
export function SpacePinnedResources({
  propertyId,
  spaceColor,
  pinnedIds,
  pinnedForms = [],
  onUnpinForm,
  allDocs,
  spaceDocs,
  workspaceCandidates,
  onPin,
  onUnpin,
  onViewAllDocs,
  totalDocs,
}: {
  propertyId: string;
  spaceColor: EntityColor;
  pinnedIds: string[];
  /** Forms pinned alongside docs (migration 0058); share the pin budget. */
  pinnedForms?: { id: string; title: string; status: string }[];
  onUnpinForm?: (id: string) => void;
  allDocs: DocumentListItem[];
  spaceDocs: PinCandidate[];
  workspaceCandidates: PinCandidate[];
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onViewAllDocs?: () => void;
  totalDocs: number;
}) {
  const docsById = useMemo(
    () => new Map(allDocs.map((d) => [d.id, d])),
    [allDocs],
  );

  const pinnedCards = useMemo((): DocPinCardData[] => {
    const cards: DocPinCardData[] = [];
    for (const id of pinnedIds) {
      const row = docsById.get(id);
      if (row) {
        cards.push({
          id: row.id,
          title: row.title,
          updated_at: row.updated_at,
          body_text: row.body_text,
        });
        continue;
      }
      const fallback = spaceDocs.find((d) => d.id === id);
      if (fallback) {
        cards.push({
          id: fallback.id,
          title: fallback.title,
          updated_at: "",
          body_text: null,
        });
      }
    }
    return cards;
  }, [pinnedIds, docsById, spaceDocs]);

  const totalPinned = pinnedIds.length + pinnedForms.length;
  const atLimit = totalPinned >= MAX_PINNED_RESOURCES;
  const accent = ACCENT_DOT[spaceColor];

  const picker = (
    <DocumentPinPicker
      spaceDocs={spaceDocs}
      workspaceCandidates={workspaceCandidates}
      onPin={onPin}
      disabled={atLimit}
      tileSize="compact"
    />
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs/[1] font-medium text-faint-foreground">
          Resources
        </h3>
        {totalPinned > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {totalPinned}/{MAX_PINNED_RESOURCES}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-md",
          pinnedCards.length === 0
            ? "bg-muted px-3 py-2.5"
            : "bg-muted px-2 py-2",
        )}
      >
        {pinnedCards.length === 0 && pinnedForms.length === 0 ? (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-xs leading-snug text-pretty text-muted-foreground">
              Pin key documents for quick access.
            </p>
            {picker}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto">
            {pinnedCards.map((doc) => (
              <DocPinCard
                key={doc.id}
                doc={doc}
                propertyId={propertyId}
                accentDotClass={accent}
                onUnpin={onUnpin}
                showPresence={false}
                size="compact"
              />
            ))}
            {pinnedForms.map((form) => (
              <FormPinCard
                key={form.id}
                form={form}
                propertyId={propertyId}
                accentDotClass={accent}
                onUnpin={onUnpinForm}
              />
            ))}
            {picker}
          </div>
        )}
      </div>

      {totalDocs > pinnedIds.length && onViewAllDocs ? (
        <button
          type="button"
          onClick={onViewAllDocs}
          className="self-start text-sm text-muted-foreground hover:text-foreground"
        >
          All documents in this space ({totalDocs})
        </button>
      ) : null}
    </section>
  );
}

/**
 * A pinned form — same compact-tile footprint as DocPinCard, linking to the
 * form's fill page (or builder for drafts).
 */
function FormPinCard({
  form,
  propertyId,
  accentDotClass,
  onUnpin,
}: {
  form: { id: string; title: string; status: string };
  propertyId: string;
  accentDotClass: string;
  onUnpin?: (id: string) => void;
}) {
  const href =
    form.status === "published"
      ? `/p/${propertyId}/forms/${form.id}/fill`
      : `/p/${propertyId}/forms/${form.id}`;
  return (
    <div className="group relative w-32 shrink-0">
      <Link
        href={href}
        className="flex h-full flex-col gap-1.5 rounded-md bg-background px-2.5 py-2 shadow-ring transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", accentDotClass)} />
          <ClipboardList className="size-3.5 text-muted-foreground" />
        </span>
        <span className="line-clamp-2 text-xs leading-snug font-medium">
          {form.title}
        </span>
        <span className="text-xs text-faint-foreground">
          {form.status === "published" ? "Form · open" : `Form · ${form.status}`}
        </span>
      </Link>
      {onUnpin ? (
        <button
          type="button"
          aria-label="Unpin form"
          onClick={() => onUnpin(form.id)}
          className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded-md text-muted-foreground group-hover:flex hover:bg-accent"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
