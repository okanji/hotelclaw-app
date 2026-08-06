"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageShell } from "@/components/ui/page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReportMarkdown } from "@/components/insights/report-markdown";
import {
  CORRECTION_MARK,
  type BrainPageDetailData,
  type BrainTimelineEntry,
} from "@/lib/brain/shared";

/**
 * One brain page: compiled truth (markdown), then the timeline — every
 * entry with its date and source, because provenance is the point. The
 * curation verbs live here: per-entry / page-level corrections
 * (supersede-by-append) and owner-only archive.
 */
export function BrainPageDetail({
  propertyId,
  slug,
  canCurate,
  canArchive,
  onBack,
  onArchived,
}: {
  propertyId: string;
  slug: string;
  canCurate: boolean;
  canArchive: boolean;
  onBack: () => void;
  onArchived: () => void;
}) {
  const qc = useQueryClient();
  const [correcting, setCorrecting] = useState<
    { supersedes?: { date: string; summary: string } } | null
  >(null);
  const [archiving, setArchiving] = useState(false);

  const pageQuery = useQuery({
    queryKey: ["brain-page", propertyId, slug],
    queryFn: async (): Promise<BrainPageDetailData> => {
      const res = await fetch(
        `/api/properties/${propertyId}/brain/page?slug=${encodeURIComponent(slug)}`,
      );
      if (!res.ok) throw new Error("failed to load page");
      const body = (await res.json()) as { page?: BrainPageDetailData };
      if (!body.page) throw new Error("failed to load page");
      return body.page;
    },
    staleTime: 15_000,
  });

  if (pageQuery.isPending) {
    return (
      <PageShell width="prose" className="px-6 py-8 lg:px-10">
        <p className="text-sm text-muted-foreground">Loading page…</p>
      </PageShell>
    );
  }
  if (pageQuery.isError) {
    return (
      <PageShell width="prose" className="px-6 py-8 lg:px-10">
        <p className="text-sm text-pretty text-muted-foreground">
          Couldn&apos;t load this page — it may have been archived, or the
          brain is briefly unreachable.
        </p>
      </PageShell>
    );
  }
  const page = pageQuery.data;

  return (
    // A brain page is a READING surface — one 720px prose column.
    <PageShell width="prose" className="px-6 py-8 lg:px-10">
      <article className="flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="mb-4 self-start text-muted-foreground lg:hidden"
      >
        <ArrowLeft data-icon="inline-start" />
        Index
      </Button>

      <header className="flex flex-col gap-2">
        <Eyebrow>{page.type}</Eyebrow>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 text-2xl font-semibold text-balance">
            {page.title}
          </h2>
          {canCurate ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCorrecting({})}>
                <MessageSquarePlus data-icon="inline-start" />
                Add correction
              </Button>
              {canArchive ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Archive page"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setArchiving(true)}
                >
                  <Archive className="size-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-muted-foreground">
            {page.slug}
          </span>
          {page.updated_at ? (
            <span className="text-xs text-muted-foreground">
              updated {formatTimestamp(page.updated_at)}
            </span>
          ) : null}
          {page.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      {page.content_flag ? (
        <p className="mt-5 rounded-card bg-warning/10 p-3 text-sm text-pretty text-warning">
          The brain flagged this page&apos;s content ({page.content_flag.reason})
          — treat it with care: {page.content_flag.detail}
        </p>
      ) : null}

      <section className="mt-8 flex flex-col gap-3">
        <Eyebrow>Compiled truth</Eyebrow>
        {page.compiled_truth.trim() ? (
          <ReportMarkdown>{page.compiled_truth}</ReportMarkdown>
        ) : (
          <p className="text-sm text-pretty text-muted-foreground">
            Nothing compiled yet — evidence accumulates on the timeline below
            until a human or the dream cycle distills it.
          </p>
        )}
      </section>

      <section className="mt-10 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 pb-2">
          <Eyebrow>Timeline</Eyebrow>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page.timeline.length}{" "}
            {page.timeline.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {page.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-border">
            {page.timeline.map((entry) => (
              <TimelineRow
                key={`${entry.id}-${entry.date}-${entry.summary.slice(0, 40)}`}
                entry={entry}
                canCurate={canCurate}
                onCorrect={() =>
                  setCorrecting({
                    supersedes: { date: entry.date, summary: entry.summary },
                  })
                }
              />
            ))}
          </ul>
        )}
      </section>

      {correcting ? (
        <CorrectionDialog
          propertyId={propertyId}
          slug={slug}
          supersedes={correcting.supersedes}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            void qc.invalidateQueries({
              queryKey: ["brain-page", propertyId, slug],
            });
          }}
        />
      ) : null}

      {archiving ? (
        <ArchiveDialog
          propertyId={propertyId}
          slug={slug}
          title={page.title}
          onClose={() => setArchiving(false)}
          onArchived={onArchived}
        />
      ) : null}
      </article>
    </PageShell>
  );
}

function TimelineRow({
  entry,
  canCurate,
  onCorrect,
}: {
  entry: BrainTimelineEntry;
  canCurate: boolean;
  onCorrect: () => void;
}) {
  const isCorrection = entry.summary.startsWith(CORRECTION_MARK);
  const summaryText = isCorrection
    ? entry.summary.slice(CORRECTION_MARK.length).trim()
    : entry.summary;

  return (
    <li className="group flex gap-4 py-3">
      <span className="w-22 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
        {entry.date}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {isCorrection ? (
            <StatusBadge tone="warning" className="translate-y-px">
              Correction
            </StatusBadge>
          ) : null}
          <p className="min-w-0 text-sm text-pretty">{summaryText}</p>
        </div>
        {entry.detail ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground select-none">
              Detail
            </summary>
            <p className="mt-1 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
              {entry.detail}
            </p>
          </details>
        ) : null}
        {entry.source ? (
          <p className="truncate font-mono text-xs text-muted-foreground/70">
            {entry.source}
          </p>
        ) : null}
      </div>
      {canCurate && !isCorrection ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onCorrect}
          className="shrink-0 self-start text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          Correct
        </Button>
      ) : null}
    </li>
  );
}

function CorrectionDialog({
  propertyId,
  slug,
  supersedes,
  onClose,
  onSaved,
}: {
  propertyId: string;
  slug: string;
  supersedes?: { date: string; summary: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      const res = await fetch(`/api/properties/${propertyId}/brain/curate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "correction",
          slug,
          note: note.trim(),
          ...(supersedes
            ? {
                supersedes: {
                  date: supersedes.date,
                  summary: supersedes.summary.slice(0, 300),
                },
              }
            : {}),
        }),
      });
      if (!res.ok) {
        toast.error("Couldn't save the correction");
        return;
      }
      toast.success("Correction recorded on the timeline");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a correction</DialogTitle>
          <DialogDescription>
            Corrections append to the timeline as operator evidence — they
            supersede what they reference without erasing it, and bots treat
            them as authoritative.
          </DialogDescription>
        </DialogHeader>
        {supersedes ? (
          <blockquote className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{supersedes.date}</span> —{" "}
            {supersedes.summary}
          </blockquote>
        ) : null}
        <Textarea
          name="correction-note"
          aria-label="Correction"
          placeholder="What's actually true?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={500}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || note.trim().length < 3}>
            {saving ? "Saving…" : "Record correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({
  propertyId,
  slug,
  title,
  onClose,
  onArchived,
}: {
  propertyId: string;
  slug: string;
  title: string;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      const res = await fetch(`/api/properties/${propertyId}/brain/curate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", slug }),
      });
      if (!res.ok) {
        toast.error("Couldn't archive the page");
        return;
      }
      toast.success("Page archived");
      onArchived();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this page?</DialogTitle>
          <DialogDescription>
            &ldquo;{title}&rdquo; disappears from search and from every bot
            immediately. It stays recoverable server-side for 72 hours, then
            it&apos;s gone for good.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? "Archiving…" : "Archive page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
