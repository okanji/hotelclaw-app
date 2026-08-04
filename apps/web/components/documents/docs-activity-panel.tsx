"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  LayoutGrid,
  Pencil,
  Pin,
  Radio,
} from "lucide-react";
import { ActivitySparkline } from "./activity-sparkline";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyState as HouseEmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  bucketActivityByDay,
  bumpLiveToday,
  collectActivityTimestamps,
  SPARKLINE_DAYS,
  sumBuckets,
} from "@/lib/documents/activity-sparkline";
import {
  buildDocActivity,
  type DocActivityItem,
} from "@/lib/documents/build-activity";
import { uniquePresenceUsers } from "@/lib/documents/presence";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import {
  documentBoardsQueryOptions,
  documentPresenceQueryOptions,
  documentsQueryOptions,
  propertyMembersQueryOptions,
  type DocumentPresenceUser,
} from "@/lib/query/section-queries";

type DocRow = {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  created_by: string | null;
  last_edited_by: string | null;
};

type LiveDoc = {
  id: string;
  title: string;
  viewers: DocumentPresenceUser[];
};

/** Slide-in activity panel (shadcn Sheet) with sparklines. */
export function DocsActivitySheet({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));

  const trackedDocIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of docs) ids.add(d.id);
    for (const b of boards) {
      for (const i of b.items) ids.add(i.document_id);
    }
    return [...ids].slice(0, 15);
  }, [docs, boards]);

  const { data: presence = [] } = useQuery(
    documentPresenceQueryOptions(propertyId, trackedDocIds),
  );

  const liveDocCount = useMemo(
    () => presence.filter((p) => uniquePresenceUsers(p.users).length > 0).length,
    [presence],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <Radio data-icon="inline-start" />
        Activity
        {liveDocCount > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {liveDocCount} live
          </Badge>
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DocsActivityPanelContent
          propertyId={propertyId}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function DocsActivityPanelContent({
  propertyId,
  onNavigate,
}: {
  propertyId: string;
  onNavigate?: () => void;
}) {
  const openDocument = useOpenDocument(propertyId);
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const trackedDocIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of docs) ids.add(d.id);
    for (const b of boards) {
      for (const i of b.items) ids.add(i.document_id);
    }
    return [...ids].slice(0, 15);
  }, [docs, boards]);

  const { data: presence = [] } = useQuery(
    documentPresenceQueryOptions(propertyId, trackedDocIds),
  );

  const docsById = useMemo(
    () => new Map(docs.map((d) => [d.id, d])),
    [docs],
  );

  const liveDocs = useMemo<LiveDoc[]>(() => {
    const out: LiveDoc[] = [];
    for (const entry of presence) {
      const viewers = uniquePresenceUsers(entry.users);
      if (viewers.length === 0) continue;
      const doc = docsById.get(entry.documentId);
      out.push({
        id: entry.documentId,
        title: doc?.title ?? "Untitled",
        viewers,
      });
    }
    return out;
  }, [presence, docsById]);

  const liveViewerCount = useMemo(
    () => liveDocs.reduce((sum, d) => sum + d.viewers.length, 0),
    [liveDocs],
  );

  const activityPoints = useMemo(
    () => collectActivityTimestamps(docs, boards),
    [docs, boards],
  );

  const propertySparkline = useMemo(() => {
    const buckets = bucketActivityByDay(activityPoints);
    return bumpLiveToday(buckets, liveViewerCount);
  }, [activityPoints, liveViewerCount]);

  const sparklineTotal = sumBuckets(propertySparkline);

  // Recent activity, with the synthetic "viewing" rows stripped — they're
  // rendered as their own structured "Live now" section above.
  const recentActivity = useMemo(
    () =>
      buildDocActivity({
        docs: docs as DocRow[],
        boards,
        members,
        presence: [],
      }),
    [docs, boards, members],
  );

  function handleOpen(
    e: React.MouseEvent<HTMLAnchorElement>,
    documentId: string,
  ) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate?.();
    openDocument(documentId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="gap-1.5 border-b border-border p-5 pr-14">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Radio className="size-3.5" />
          </span>
          <SheetTitle className="flex-1">Activity</SheetTitle>
          {liveDocs.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-success" />
              {liveDocs.length} live
            </Badge>
          ) : null}
        </div>
        <SheetDescription>
          Live viewers, edits, and pins across your team.
        </SheetDescription>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-5">
          <StatsCard
            total={sparklineTotal}
            sparkline={propertySparkline}
            pulse={liveViewerCount > 0}
          />

          {liveDocs.length > 0 ? (
            <Section title="Live now" count={liveDocs.length}>
              <ul role="list" className="flex flex-col gap-px">
                {liveDocs.map((doc) => (
                  <li key={doc.id}>
                    <LiveDocRow
                      doc={doc}
                      propertyId={propertyId}
                      onOpen={handleOpen}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Recent">
            {recentActivity.length === 0 ? (
              <EmptyState />
            ) : (
              <ul role="list" className="flex flex-col gap-px">
                {recentActivity.map((item) => (
                  <li key={item.id}>
                    <ActivityRow
                      item={item}
                      propertyId={propertyId}
                      docTitle={
                        item.documentId
                          ? docsById.get(item.documentId)?.title
                          : undefined
                      }
                      onOpen={handleOpen}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{title}</Eyebrow>
        {typeof count === "number" ? (
          <span className="text-xs text-faint-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatsCard({
  total,
  sparkline,
  pulse,
}: {
  total: number;
  sparkline: number[];
  pulse: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-muted p-4">
      {/* Stacked stat: 12px/12px w500 faint label ABOVE the 24px tabular
          value — the house order (`ui/stat`, `ui/stat-card`). */}
      <div className="min-w-0">
        <p className="text-xs leading-3 font-medium whitespace-nowrap text-faint-foreground">
          events · last {SPARKLINE_DAYS} days
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
          {total}
        </p>
      </div>
      <ActivitySparkline
        values={sparkline}
        size="lg"
        pulseLast={pulse}
        className="text-muted-foreground"
      />
    </div>
  );
}

function LiveDocRow({
  doc,
  propertyId,
  onOpen,
}: {
  doc: LiveDoc;
  propertyId: string;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>, documentId: string) => void;
}) {
  return (
    <Link
      href={documentHref(propertyId, doc.id)}
      onClick={(e) => onOpen(e, doc.id)}
      className="group flex items-center gap-3 rounded-md px-1.5 py-2 outline-none transition-colors hover:bg-accent focus-visible:shadow-focus"
    >
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {doc.title}
        </p>
        <p className="mt-0.5 text-xs text-faint-foreground">
          {doc.viewers.length === 1
            ? `${doc.viewers[0].name} is here`
            : `${doc.viewers.length} people are here`}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {doc.viewers.slice(0, 4).map((u, index) => (
          <Avatar
            key={u.id}
            className={cn(
              "size-6 border-2 border-background",
              index > 0 && "-ml-1.5",
            )}
            title={u.name}
          >
            <AvatarImage src={u.avatar} alt={u.name} />
            <AvatarFallback className="text-xs">
              {(u.name[0] ?? "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {doc.viewers.length > 4 ? (
          <span className="-ml-1.5 flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-medium text-muted-foreground tabular-nums">
            +{doc.viewers.length - 4}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function ActivityRow({
  item,
  propertyId,
  docTitle,
  onOpen,
}: {
  item: DocActivityItem;
  propertyId: string;
  docTitle?: string;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>, documentId: string) => void;
}) {
  const title = docTitle ?? item.documentTitle ?? item.boardName ?? "Untitled";

  const content = (
    <div className="flex items-start gap-3 px-1 py-3">
      <ActivityIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-pretty text-muted-foreground">
          {renderLabel(item, title)}
        </p>
      </div>
      <span className="shrink-0 pt-0.5 text-xs text-faint-foreground tabular-nums">
        {relativeTime(item.at)}
      </span>
    </div>
  );

  if (item.documentId) {
    return (
      <Link
        href={documentHref(propertyId, item.documentId)}
        onClick={(e) => onOpen(e, item.documentId!)}
        className="block rounded-md outline-none transition-colors hover:bg-accent focus-visible:shadow-focus"
      >
        {content}
      </Link>
    );
  }

  return content;
}

function ActivityIcon({ kind }: { kind: DocActivityItem["kind"] }) {
  const Icon =
    kind === "edited"
      ? Pencil
      : kind === "pinned"
        ? Pin
        : kind === "board-created"
          ? LayoutGrid
          : FileText;

  return (
    <span
      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      aria-hidden="true"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function renderLabel(item: DocActivityItem, title: string): React.ReactNode {
  switch (item.kind) {
    case "edited":
      return (
        <>
          {item.actorName ? (
            <>
              <span className="font-medium text-foreground">
                {item.actorName}
              </span>{" "}
              updated{" "}
            </>
          ) : (
            <>Updated </>
          )}
          <span className="font-medium text-foreground">{title}</span>
        </>
      );
    case "pinned":
      return (
        <>
          Pinned <span className="font-medium text-foreground">{title}</span>
          {item.boardName ? (
            <>
              {" "}
              to{" "}
              <span className="font-medium text-foreground">
                {item.boardName}
              </span>
            </>
          ) : null}
        </>
      );
    case "board-created":
      return (
        <>
          {item.actorName ? (
            <>
              <span className="font-medium text-foreground">
                {item.actorName}
              </span>{" "}
              created board{" "}
            </>
          ) : (
            <>New board </>
          )}
          <span className="font-medium text-foreground">{title}</span>
        </>
      );
    default:
      return <span className="font-medium text-foreground">{title}</span>;
  }
}

function EmptyState() {
  return (
    <HouseEmptyState icon={Radio} title="No recent activity">
      Edits, pins, and board changes from the last week will show up here.
    </HouseEmptyState>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
