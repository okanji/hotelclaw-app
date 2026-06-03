"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  FileText,
  ListChecks,
  MessagesSquare,
  Plus,
  Sparkles,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import type { DocumentListItem } from "@/lib/documents/queries";
import { DocBoardsSection } from "@/components/documents/doc-boards-section";
import { DocBoardsBoard } from "@/components/documents/doc-boards-board";
import { CreateDocumentDialog } from "@/components/documents/create-document-dialog";
import { GenerateDocumentDialog } from "@/components/documents/generate-document-dialog";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

const RECENT_LIMIT = 6;

type Shortcut = {
  label: string;
  description: string;
  icon: LucideIcon;
  href: (propertyId: string) => string;
};

/** The work surfaces reachable from Home — same destinations as the rail. */
const SHORTCUTS: Shortcut[] = [
  {
    label: "Tasks",
    description: "Board & assignments",
    icon: ListChecks,
    href: (p) => `/p/${p}/tasks`,
  },
  {
    label: "Docs",
    description: "Team knowledge base",
    icon: FileText,
    href: (p) => `/p/${p}/documents`,
  },
  {
    label: "Calendar",
    description: "Schedule & shifts",
    icon: CalendarDays,
    href: (p) => `/p/${p}/calendar`,
  },
  {
    label: "Chat",
    description: "Channels & threads",
    icon: MessagesSquare,
    href: (p) => `/p/${p}/chat`,
  },
  {
    label: "Workflows",
    description: "Automations",
    icon: Workflow,
    href: (p) => `/p/${p}/workflows`,
  },
  {
    label: "Meetings",
    description: "Calls & recaps",
    icon: Video,
    href: (p) => `/p/${p}/meetings`,
  },
  {
    label: "Activity",
    description: "Mentions & updates",
    icon: Bell,
    href: (p) => `/p/${p}/activity`,
  },
];

/**
 * Property "Home" — the team landing surface (mirrors Linear's Team Home).
 * Quick doc creation, the same team-pinned Boards strip the Docs home shows,
 * shortcuts into every work surface, and the most recently edited docs. The
 * Boards strip reuses `DocBoardsBoard` so pin/unpin drag behaves identically
 * here and on the Docs home — one source of truth.
 */
export function HomeView({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { data: docs } = useQuery(documentsQueryOptions(propertyId));

  const recent = useMemo(
    () => (docs ?? []).slice(0, RECENT_LIMIT),
    [docs],
  );

  return (
    <DocBoardsBoard propertyId={propertyId}>
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
        <header className="flex flex-col gap-8">
          <div className="flex items-end justify-between gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Team Home
              </p>
              <h1 className="text-[2.75rem] leading-none font-semibold tracking-tight text-foreground sm:text-[3.25rem]">
                {propertyName}
              </h1>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setGenerateOpen(true)}
              >
                <Sparkles className="size-4" />
                Generate
              </Button>
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New doc
              </Button>
            </div>
          </div>
        </header>

        <hr className="my-10 border-border" />

        <section>
          <SectionHeading kicker="Jump to">Workspaces</SectionHeading>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {SHORTCUTS.map((s) => (
              <Link
                key={s.label}
                href={s.href(propertyId)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3.5 py-3 transition-all",
                  "hover:border-foreground/15 hover:bg-muted/40 hover:shadow-sm",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground transition-colors group-hover:text-foreground">
                  <s.icon className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.875rem] font-medium tracking-tight text-foreground">
                    {s.label}
                  </span>
                  <span className="truncate text-[0.75rem] tracking-tight text-muted-foreground">
                    {s.description}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-14 flex flex-col gap-14">
          <section>
            <SectionHeading kicker="Pinned by the team">
              Resources
            </SectionHeading>
            <DocBoardsSection propertyId={propertyId} />
          </section>

          <section>
            <SectionHeading
              kicker="In motion"
              right={
                <Link
                  href={`/p/${propertyId}/documents`}
                  className="text-[0.75rem] tracking-tight text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  All documents
                </Link>
              }
            >
              Recent documents
            </SectionHeading>
            <RecentDocs propertyId={propertyId} docs={recent} />
          </section>
        </div>
      </div>

      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        propertyId={propertyId}
      />
      <GenerateDocumentDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        propertyId={propertyId}
      />
    </DocBoardsBoard>
  );
}

function RecentDocs({
  propertyId,
  docs,
}: {
  propertyId: string;
  docs: DocumentListItem[];
}) {
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-6 py-12 text-center">
        <FileText
          strokeWidth={1.5}
          className="size-7 text-muted-foreground/50"
        />
        <p className="text-sm text-pretty text-muted-foreground">
          No documents yet — create one to get started.
        </p>
      </div>
    );
  }

  return (
    <ul
      role="list"
      className="flex flex-col divide-y divide-border/40 border-t border-border/40"
    >
      {docs.map((d) => (
        <RecentDocRow key={d.id} propertyId={propertyId} doc={d} />
      ))}
    </ul>
  );
}

function RecentDocRow({
  propertyId,
  doc,
}: {
  propertyId: string;
  doc: DocumentListItem;
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  return (
    <li className="group/row relative">
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        className="flex items-center gap-3 px-2 py-2.5"
      >
        <FileText
          strokeWidth={1.5}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium tracking-tight text-foreground">
          {doc.title || "Untitled"}
        </span>
        <span className="shrink-0 text-[0.75rem] tracking-tight text-muted-foreground tabular-nums">
          {formatRelativeShort(doc.updated_at)}
        </span>
      </Link>
    </li>
  );
}

function SectionHeading({
  kicker,
  children,
  right,
}: {
  kicker: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
      <div className="flex flex-col gap-1">
        <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
          {kicker}
        </span>
        <h2 className="text-[1.375rem] font-semibold tracking-tight text-foreground">
          {children}
        </h2>
      </div>
      {right}
    </div>
  );
}

/** Compact relative time ("now", "3m", "2h", "5d", or absolute date past 7d). */
function formatRelativeShort(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
