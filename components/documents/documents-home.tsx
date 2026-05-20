"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pin, PinOff, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { createDocument } from "./actions";
import { DocumentList } from "./document-list";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";
import { useRecentDocs } from "@/lib/documents/use-recent-docs";

/**
 * Documents section home / dashboard.
 *
 * Three stacked sections on top of the existing all-docs list:
 *   • Pinned — per-device localStorage pins (newest first), with a small
 *     empty-state nudge once the property has at least one doc.
 *   • Recently opened — the last few docs the user opened, recorded by
 *     `<RecentDocsRecorder>` mounted on the doc detail route.
 *   • All documents — the existing `<DocumentList>` (slimmed; this page
 *     owns the header and the New-document control).
 *
 * Pinned + Recents are derived from the same `["documents", propertyId]`
 * cache as the all-docs list, so any pinned/recent id that's been archived
 * silently drops off without a separate fetch.
 */
export function DocumentsHome({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const openDocument = useOpenDocument(propertyId);
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  // Plain left-click → client-side `pushState` switch via the persistent
  // DocumentsSurface (no route nav, no skeleton flash). Modified clicks fall
  // through to the browser so "open in new tab" still works.
  function handleOpen(
    e: React.MouseEvent<HTMLAnchorElement>,
    documentId: string,
  ) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(documentId);
  }

  const { data: docs } = useQuery(documentsQueryOptions(propertyId));
  const docsList = docs ?? [];
  const docsById = useMemo(
    () => new Map(docsList.map((d) => [d.id, d])),
    [docsList],
  );

  const { pinnedIds, togglePin } = usePinnedDocs(propertyId);
  const recents = useRecentDocs(propertyId);

  // Resolve pin/recent IDs against the live docs cache — archived ids return
  // undefined and silently drop out, so we never render a dead pin.
  const pinnedDocs = useMemo(
    () =>
      pinnedIds
        .map((id) => docsById.get(id))
        .filter((d): d is NonNullable<typeof d> => !!d),
    [pinnedIds, docsById],
  );

  const recentDocs = useMemo(
    () =>
      recents
        .map((e) => {
          const doc = docsById.get(e.id);
          return doc ? { ...doc, openedAt: e.openedAt } : null;
        })
        .filter(
          (d): d is NonNullable<typeof d> => !!d,
        )
        .slice(0, 6),
    [recents, docsById],
  );

  const hasDocs = docsList.length > 0;
  const hasPins = pinnedDocs.length > 0;
  const hasRecents = recentDocs.length > 0;

  function handleCreate() {
    setCreateError(null);
    startCreate(async () => {
      const res = await createDocument(propertyId);
      if ("error" in res) {
        setCreateError(res.error);
        return;
      }
      router.push(`/p/${propertyId}/documents/${res.id}`);
    });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="text-sm text-muted-foreground">
            Pinned docs, recently opened, and everything else for this property.
          </p>
        </div>
        <Button type="button" onClick={handleCreate} disabled={creating}>
          <Plus className="size-4" /> New document
        </Button>
      </header>

      {createError ? (
        <p className="mb-4 text-sm text-destructive">{createError}</p>
      ) : null}

      {/* Pinned — hidden entirely on an empty property; shows a small nudge
          once docs exist but none are pinned yet, so the feature is
          discoverable without cluttering the day-one view. */}
      {hasPins || hasDocs ? (
        <section className="mb-8">
          <SectionHeading>Pinned</SectionHeading>
          {hasPins ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pinnedDocs.map((d) => (
                <PinnedCard
                  key={d.id}
                  propertyId={propertyId}
                  doc={d}
                  onOpen={handleOpen}
                  onUnpin={() => togglePin(d.id)}
                />
              ))}
            </div>
          ) : (
            <PinnedEmpty />
          )}
        </section>
      ) : null}

      {hasRecents ? (
        <section className="mb-8">
          <SectionHeading>Recently opened</SectionHeading>
          <ul className="space-y-0.5">
            {recentDocs.map((d) => (
              <li key={d.id}>
                <Link
                  href={documentHref(propertyId, d.id)}
                  onClick={(e) => handleOpen(e, d.id)}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(d.openedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionHeading
          right={
            hasDocs ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {docsList.length} {docsList.length === 1 ? "doc" : "docs"}
              </span>
            ) : null
          }
        >
          All documents
        </SectionHeading>
        <DocumentList propertyId={propertyId} />
      </section>
    </div>
  );
}

function SectionHeading({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {right}
    </div>
  );
}

function PinnedEmpty() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
      <Pin className="size-3.5 shrink-0" />
      <span>
        Click the pin icon on any doc below to keep it within reach here.
      </span>
    </div>
  );
}

function PinnedCard({
  propertyId,
  doc,
  onOpen,
  onUnpin,
}: {
  propertyId: string;
  doc: { id: string; title: string; updated_at: string };
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>, documentId: string) => void;
  onUnpin: () => void;
}) {
  return (
    // The whole tile is one hover group so hovering the unpin button (which
    // sits visually inside the card) still lights the card's hover styles —
    // hit-testing would otherwise put the button on top and break :hover on
    // the Link below.
    <div className="group relative">
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={(e) => onOpen(e, doc.id)}
        className={cn(
          "flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition",
          "group-hover:border-foreground/20 group-hover:bg-muted/30",
        )}
      >
        <FileText className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
            {doc.title || "Untitled"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {relativeTime(doc.updated_at)}
          </p>
        </div>
      </Link>
      <button
        type="button"
        aria-label="Unpin document"
        title="Unpin"
        onClick={onUnpin}
        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <PinOff className="size-3.5" />
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
