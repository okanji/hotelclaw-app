"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClipboardList, X } from "lucide-react";
import type { EntityColor } from "@/lib/db/types";
import type { DocumentListItem } from "@/lib/documents/queries";
import { cn } from "@/lib/utils";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
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
      <div className="flex items-center gap-2">
        <h3 className="text-xs/[1] font-medium text-faint-foreground">
          Resources
        </h3>
        {totalPinned > 0 ? (
          // Count-badge recipe (beautiful-ui-style skill §3): counts are
          // typographic objects, not bare text.
          <span
            title={`${totalPinned} of ${MAX_PINNED_RESOURCES} pins used`}
            className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground shadow-ring tabular-nums"
          >
            {totalPinned}/{MAX_PINNED_RESOURCES}
          </span>
        ) : null}
      </div>

      {/* Cards sit directly on the page — separation comes from each card's
          own shadow-card ring, not a grey trough (the well read as a dark
          slab, especially in dark mode). `-m-1.5 p-1.5` keeps shadow room
          inside the scroll container so rings aren't clipped at the edge. */}
      {pinnedCards.length === 0 && pinnedForms.length === 0 ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs leading-snug text-pretty text-muted-foreground">
            Pin key documents for quick access.
          </p>
          {picker}
        </div>
      ) : (
        <div className="-m-1.5 flex gap-2 overflow-x-auto p-1.5">
          {pinnedCards.map((doc, i) => (
            <DocPinCard
              key={doc.id}
              doc={doc}
              propertyId={propertyId}
              accentDotClass={accent}
              onUnpin={onUnpin}
              showPresence={false}
              size="compact"
              index={i}
            />
          ))}
          {pinnedForms.map((form, i) => (
            <FormPinCard
              key={form.id}
              form={form}
              propertyId={propertyId}
              accentDotClass={accent}
              onUnpin={onUnpinForm}
              index={pinnedCards.length + i}
            />
          ))}
          {picker}
        </div>
      )}

      {totalDocs > pinnedIds.length && onViewAllDocs ? (
        <button
          type="button"
          onClick={onViewAllDocs}
          className="-mx-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          All documents in this space
          <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-xs font-medium shadow-ring tabular-nums">
            {totalDocs}
          </span>
        </button>
      ) : null}
    </section>
  );
}

/**
 * A pinned form — same Beautiful UI card anatomy as the compact DocPinCard
 * (header bar: dot · icon · status meta over a hairline; title body), same
 * footprint, same staggered entrance, linking to the form's fill page (or
 * builder for drafts).
 */
function FormPinCard({
  form,
  propertyId,
  accentDotClass,
  onUnpin,
  index,
}: {
  form: { id: string; title: string; status: string };
  propertyId: string;
  accentDotClass: string;
  onUnpin?: (id: string) => void;
  index?: number;
}) {
  const href =
    form.status === "published"
      ? `/p/${propertyId}/forms/${form.id}/fill`
      : `/p/${propertyId}/forms/${form.id}`;
  const open = form.status === "published";
  return (
    <div
      className={cn(
        "group/card relative h-[7.5rem] w-44 shrink-0",
        index !== undefined && "ai-fade-up",
      )}
      style={
        index !== undefined
          ? { animationDelay: `${Math.min(index, 7) * 70}ms` }
          : undefined
      }
    >
      <Link
        href={href}
        className="flex h-full flex-col overflow-hidden rounded-card bg-card text-left shadow-card transition-colors hover:bg-accent"
      >
        <span className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border px-2">
          {/* Neutral tile beside the docs' blue one — same badge grammar,
              so kind is readable at a glance without a rainbow. */}
          <span
            className="flex size-4.5 shrink-0 items-center justify-center rounded-[4px] bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <ClipboardList className="size-3" strokeWidth={2.25} />
          </span>
          <span
            className={cn("size-1.5 shrink-0 rounded-full", accentDotClass)}
            aria-hidden="true"
          />
          <span
            className={cn(
              "ml-auto truncate text-xs transition-opacity group-hover/card:opacity-0",
              open ? "text-success" : "text-faint-foreground",
            )}
          >
            {open ? "Open" : form.status}
          </span>
        </span>
        <span className="min-h-0 flex-1 px-2.5 py-1.5">
          <span className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
            {form.title}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Fill-in form
          </span>
        </span>
      </Link>
      {onUnpin ? (
        <button
          type="button"
          aria-label="Unpin form"
          onClick={() => onUnpin(form.id)}
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md bg-card text-faint-foreground opacity-0 transition-colors group-hover/card:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:shadow-focus"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
