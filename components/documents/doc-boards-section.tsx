"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { useSortable, SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  BOARD_COLORS,
  documentBoardsQueryOptions,
  documentsQueryOptions,
  type BoardColor,
  type DocumentBoardRow,
} from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { DocumentViewerAvatarStack } from "@/components/documents/document-presence-stack";
import {
  useDocsHomePresence,
  useDocsHomePresenceMap,
} from "@/components/documents/docs-home-presence";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";
import {
  createBoard,
  deleteBoard,
  pinDocument,
  renameBoard,
  setBoardColor,
  unpinDocument,
} from "./board-actions";

/** Small accent dot in the board header. Matches the DB's color check. */
const COLOR_DOT: Record<BoardColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
/** Soft tint behind a board's drop-zone, used when a drag is over the strip. */
const COLOR_DROP_TINT: Record<BoardColor, string> = {
  slate: "bg-slate-500/5 ring-slate-500/20",
  blue: "bg-blue-500/5 ring-blue-500/25",
  green: "bg-emerald-500/5 ring-emerald-500/25",
  amber: "bg-amber-500/5 ring-amber-500/25",
  rose: "bg-rose-500/5 ring-rose-500/25",
  violet: "bg-violet-500/5 ring-violet-500/25",
};
/** Per-color swatch + label for the color picker. */
const COLOR_LABEL: Record<BoardColor, string> = {
  slate: "Slate",
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  violet: "Violet",
};

const EMPTY_BOARDS: DocumentBoardRow[] = [];

type DocRow = {
  id: string;
  title: string;
  updated_at: string;
  // Full plaintext from the Liveblocks `ydocUpdated` webhook snapshot
  // (see `app/api/liveblocks/webhook/route.ts`). Empty for fresh docs and
  // until the first 60s-throttled snapshot lands. Cards slice client-side.
  body_text: string;
};

/**
 * Team-shared "Boards" strip at the top of the docs home — a curated,
 * drag-and-drop dashboard above the all-docs list.
 *
 * Each board is one horizontal strip: name + color accent + ⋮ menu, then a
 * row of doc cards (drag-source) ending in a dotted drop slot. A "+ New board"
 * tile sits below the last board. Cards and rows are wired into the parent
 * `DndContext` (owned by `DocumentsHome`); this component renders + mutates
 * but doesn't own drag state.
 *
 * Realtime: subscribes to `document_boards` + `document_board_items`
 * postgres_changes for this property and invalidates the boards query so a
 * teammate's drag, rename, or color change appears live for everyone.
 *
 * Empty state: when the property has docs but no boards yet, render a single
 * "Create your first board" CTA inline instead of nothing — so the feature is
 * discoverable. Once any board exists the CTA goes away.
 */
export function DocBoardsSection({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { data: boards = EMPTY_BOARDS } = useQuery(
    documentBoardsQueryOptions(propertyId),
  );
  const { data: docs } = useQuery(documentsQueryOptions(propertyId));
  const docsById = useMemo(
    () => new Map((docs ?? []).map((d) => [d.id, d])),
    [docs],
  );

  // Realtime: invalidate on any change to either table for this property.
  // RLS scopes events to the rows the user can read, so we don't filter
  // document_board_items by property here (the property column lives on
  // the parent board); a stray cross-property echo would be invisible anyway.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`document-boards:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_boards",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["document-boards", propertyId],
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_board_items",
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["document-boards", propertyId],
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, queryClient]);

  const [creatingBoard, setCreatingBoard] = useState(false);
  const handleCreate = useCallback(async () => {
    setCreatingBoard(true);
    const res = await createBoard(propertyId);
    setCreatingBoard(false);
    if ("error" in res) toast.error(res.error);
    // The new board appears via realtime invalidation; the BoardHeader will
    // pick up the empty-title default and the user can rename in place.
  }, [propertyId]);

  // Empty property → don't take vertical space. Property has docs but no
  // boards → show the discoverability CTA so the user knows boards exist.
  if (boards.length === 0) {
    if (!docs || docs.length === 0) return null;
    return <EmptyBoardsCallout onCreate={handleCreate} pending={creatingBoard} />;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Boards</h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {boards.length}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreate}
          disabled={creatingBoard}
          className="h-8"
        >
          <Plus className="size-3.5" />
          {creatingBoard ? "Creating…" : "New board"}
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        {boards.map((board) => (
          <BoardStrip
            key={board.id}
            board={board}
            docsById={docsById}
            propertyId={propertyId}
          />
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Board strip                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function BoardStrip({
  board,
  docsById,
  propertyId,
}: {
  board: DocumentBoardRow;
  docsById: Map<string, DocRow>;
  propertyId: string;
}) {
  // Items sorted by position — Supabase nested ordering is finicky, so we
  // sort client-side (lists are tiny).
  const items = useMemo(
    () => [...board.items].sort((a, b) => a.position - b.position),
    [board.items],
  );
  const itemIds = useMemo(() => items.map((i) => `card:${i.document_id}`), [items]);

  // The whole strip is a droppable so the user doesn't need to aim at the
  // dotted tile; the tile is just a visual hint at the end. No outer card
  // frame — the cards themselves are the visible surface; the strip is just
  // header + horizontal scroll, with a soft tint on the scroll row when a
  // drag is hovering.
  const { setNodeRef, isOver } = useDroppable({
    id: `board:${board.id}`,
    data: { type: "board", boardId: board.id },
  });

  // Owned locally so `DocCard`'s remove-from-board button has a single
  // call-site for optimistic update + server action + toast. Re-pinning on
  // undo lands the doc back on this board (position appended at the end).
  const { pin, unpin } = useBoardMutations(propertyId);

  async function handleUnpin(docId: string) {
    await unpin(docId);
    toast.success("Removed from board", {
      action: {
        label: "Undo",
        onClick: () => void pin(docId, board.id),
      },
    });
  }

  const hasItems = items.length > 0;

  return (
    <div className="group/board border-b border-border/50 pb-8 last:border-b-0 last:pb-0">
      <BoardHeader board={board} />
      <div
        ref={setNodeRef}
        className={cn(
          "flex gap-3 overflow-x-auto py-2",
          isOver && cn("rounded-lg ring-1 ring-inset", COLOR_DROP_TINT[board.color]),
        )}
      >
        <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
          {hasItems ? (
            <>
              {items.map((item) => {
                const doc = docsById.get(item.document_id);
                if (!doc) return null;
                return (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    propertyId={propertyId}
                    boardColor={board.color}
                    onUnpin={handleUnpin}
                  />
                );
              })}
              {/* Only show the trailing drop tile when the board already has
                  cards — empty boards delegate the "drop target" hint to
                  `BoardEmptyHint`, which spans the whole strip. */}
              <DropSlot />
            </>
          ) : (
            <BoardEmptyHint />
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function BoardHeader({ board }: { board: DocumentBoardRow }) {
  const presenceMap = useDocsHomePresenceMap();
  const liveCount = board.items.filter(
    (i) => (presenceMap.get(i.document_id)?.length ?? 0) > 0,
  ).length;
  // Notion-style: no view/edit toggle. The title is always an `<input>`
  // styled like a plain heading — no border, no background, no field chrome.
  // Click anywhere on the title row to position the cursor; blur or Enter
  // commits. The shadcn `<Input>` is intentionally not used here because its
  // visual chrome (ring, border, h-10) is the whole thing the user is
  // asking us to drop.
  const [name, setName] = useState(board.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from server when this user isn't actively editing. Without the
  // focus check, a teammate's rename would yank the input value out from
  // under a user mid-edit.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setName(board.name);
    }
  }, [board.name]);

  async function commitRename() {
    const next = name.trim();
    if (!next || next === board.name) {
      setName(board.name);
      return;
    }
    const res = await renameBoard(board.id, next);
    if ("error" in res) {
      toast.error(res.error);
      setName(board.name);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      `Delete board "${board.name}"? Pinned docs stay in the library.`,
    );
    if (!ok) return;
    const res = await deleteBoard(board.id);
    if ("error" in res) toast.error(res.error);
  }

  async function handleColor(color: BoardColor) {
    const res = await setBoardColor(board.id, color);
    if ("error" in res) toast.error(res.error);
  }

  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className={cn(
          "inline-block size-2 shrink-0 rounded-full",
          COLOR_DOT[board.color],
        )}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void commitRename()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
          }
          if (e.key === "Escape") {
            setName(board.name);
            inputRef.current?.blur();
          }
        }}
        placeholder="Untitled board"
        aria-label="Board name"
        className={cn(
          "min-w-0 flex-1 truncate bg-transparent text-base font-semibold tracking-tight text-foreground",
          "outline-none placeholder:text-muted-foreground/60",
        )}
      />
      <span className="shrink-0 rounded-md bg-muted/60 px-2 py-0.5 text-sm text-muted-foreground tabular-nums">
        {board.items.length}
      </span>
      {liveCount > 0 ? (
        <Badge variant="secondary" className="tabular-nums">
          {liveCount} live
        </Badge>
      ) : null}
      <div className="opacity-0 transition-opacity group-hover/board:opacity-100 focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Board actions"
                title="Board actions"
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem
              onClick={() => {
                inputRef.current?.focus();
                inputRef.current?.select();
              }}
            >
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Color
              </DropdownMenuLabel>
              {BOARD_COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onClick={() => void handleColor(c)}
                  className="gap-2"
                >
                  <span
                    className={cn("size-3 shrink-0 rounded-full", COLOR_DOT[c])}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{COLOR_LABEL[c]}</span>
                  {board.color === c ? <Check className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleDelete()}
              className="text-destructive"
            >
              <Trash2 className="size-4" /> Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function BoardEmptyHint() {
  return (
    <div className="flex h-48 min-w-[12rem] flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-4 text-center">
      <span
        className="flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground"
        aria-hidden="true"
      >
        <Pin strokeWidth={1.75} className="size-4" />
      </span>
      <p className="max-w-[24ch] text-sm text-pretty text-muted-foreground">
        Drag a document here to pin it for your team.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Doc card                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function DocCard({
  doc,
  propertyId,
  boardColor,
  onUnpin,
}: {
  doc: DocRow;
  propertyId: string;
  boardColor: BoardColor;
  /** Called when the user clicks the hover-revealed remove button. */
  onUnpin: (documentId: string) => void;
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `card:${doc.id}`,
      data: { type: "card", documentId: doc.id },
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  // The remove button sits *over* the draggable wrapper. Two things must not
  // happen on click: (a) the underlying <Link> shouldn't navigate, and
  // (b) `useSortable`'s pointer listeners on the wrapper shouldn't start a
  // drag. We stop propagation on both pointerdown and click for that.
  function handleUnpinClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    onUnpin(doc.id);
  }

  // Page-thumbnail layout: white page-shaped card with title at the top, a
  // hairline divider, and the body snippet rendered as the page's content.
  // The text is the server-side plaintext snapshot from `documents.body_text`,
  // captured by the Liveblocks `ydocUpdated` webhook — see
  // `app/api/liveblocks/webhook/route.ts`. Slice client-side to keep cards
  // compact; the full body sits in the React Query cache regardless.
  const snippet = doc.body_text?.trim().slice(0, 500) ?? "";
  const viewers = useDocsHomePresence(doc.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/card relative shrink-0",
        isDragging && "opacity-40",
      )}
      // Drag attributes go on the wrapper so the whole card is the grab
      // surface; the inner Link still fires click for navigation.
      {...attributes}
      {...listeners}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className={cn(
          "flex h-48 w-40 cursor-grab flex-col overflow-hidden rounded-lg border border-border/80 bg-card text-left transition-[box-shadow,border-color,background-color] duration-150",
          "active:cursor-grabbing",
          "group-hover/card:border-foreground/30 group-hover/card:bg-muted/40 group-hover/card:shadow-md group-hover/card:shadow-foreground/5",
          "dark:shadow-none dark:inset-ring dark:inset-ring-white/5 dark:group-hover/card:inset-ring-white/10",
        )}
      >
        <div className="flex-1 overflow-hidden p-3">
          <h3 className="line-clamp-2 pr-6 text-sm font-medium text-foreground">
            {doc.title || "Untitled"}
          </h3>
          <div className="my-2 h-px bg-border/50" />
          {snippet ? (
            <p className="line-clamp-5 whitespace-pre-line text-sm text-muted-foreground">
              {snippet}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/70">Empty document</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                COLOR_DOT[boardColor],
              )}
              aria-hidden="true"
            />
            <span className="text-sm text-muted-foreground tabular-nums">
              {relativeTime(doc.updated_at)}
            </span>
          </span>
          <DocumentViewerAvatarStack users={viewers} size={18} />
        </div>
      </Link>

      {/* Remove-from-board affordance. Hover/focus-revealed so it doesn't
          compete with the card content at rest. Positioned absolutely over
          the top-right corner; the title above reserves `pr-6` so a long
          title can't slide under it. Pointer-events explicitly enabled so
          the button is clickable even though it floats over the Link.
          `onPointerDown` stops the sortable's drag activation. */}
      <button
        type="button"
        aria-label="Remove from board"
        title="Remove from board"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleUnpinClick}
        className={cn(
          "absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md border border-border/60 bg-card/95 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity",
          "group-hover/card:opacity-100 focus-visible:opacity-100",
          "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring/60",
        )}
      >
        <X strokeWidth={2} className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Trailing drop hint at the end of a non-empty board strip. Permanently
 * visible so the drop target is discoverable, but takes on two different
 * shapes:
 *
 *   - idle:   narrow, faint column with only a small pin icon — a quiet
 *             "you can drop here" marker that doesn't compete with cards
 *   - active: expands to card width with a bright dashed outline + label
 *             when *anything* is being dragged (a card from this board,
 *             a card from another board, or a row from the library below)
 */
function DropSlot() {
  const { active } = useDndContext();
  const isDragging = !!active;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-48 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-all duration-200",
        isDragging
          ? "w-40 border-foreground/30 bg-muted/20 text-foreground/70"
          : "w-20 border-border/40 text-muted-foreground/40 group-hover/board:border-border/70",
      )}
    >
      <Pin
        strokeWidth={1.75}
        className={cn(
          "transition-all",
          isDragging ? "size-5" : "size-3.5",
        )}
      />
      {isDragging ? (
        <span className="text-xs font-medium">Drop here</span>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  New-board tile + empty-state                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function EmptyBoardsCallout({
  onCreate,
  pending,
}: {
  onCreate: () => void;
  pending: boolean;
}) {
  return (
    <section className="border-b border-border/50 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            Pin your most-used documents
          </h2>
          <p className="mt-1 max-w-[48ch] text-sm text-pretty text-muted-foreground">
            Create a board and drag documents from the library — everyone on
            this property sees the same layout.
          </p>
        </div>
        <Button
          type="button"
          onClick={onCreate}
          disabled={pending}
          size="sm"
          className="shrink-0"
        >
          <Plus className="size-4" />
          {pending ? "Creating…" : "Create board"}
        </Button>
      </div>
    </section>
  );
}

/**
 * Mutation helpers — optimistic update + server action + toast on error.
 * Exposed via hook so the parent (`DocumentsHome`) can call them from
 * `onDragEnd` without having to thread props through `<BoardStrip>`.
 */
export function useBoardMutations(propertyId: string) {
  const queryClient = useQueryClient();
  const key = documentBoardsQueryOptions(propertyId).queryKey;

  const pin = useCallback(
    async (documentId: string, boardId: string) => {
      const snapshot = queryClient.getQueryData<DocumentBoardRow[]>(key);
      queryClient.setQueryData<DocumentBoardRow[]>(key, (current) => {
        if (!current) return current;
        const target = current.find((b) => b.id === boardId);
        const maxPos =
          target?.items.reduce((m, i) => Math.max(m, i.position), 0) ?? 0;
        return current.map((b) => {
          if (b.id === boardId) {
            // Already there? leave as-is (avoids reordering on drop-on-self).
            const filtered = b.items.filter(
              (i) => i.document_id !== documentId,
            );
            return {
              ...b,
              items: [
                ...filtered,
                {
                  document_id: documentId,
                  position: maxPos + 1024,
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }
          return {
            ...b,
            items: b.items.filter((i) => i.document_id !== documentId),
          };
        });
      });
      const res = await pinDocument(documentId, boardId);
      if ("error" in res) {
        toast.error(res.error);
        if (snapshot) queryClient.setQueryData(key, snapshot);
      }
    },
    [queryClient, key],
  );

  const unpin = useCallback(
    async (documentId: string) => {
      const snapshot = queryClient.getQueryData<DocumentBoardRow[]>(key);
      queryClient.setQueryData<DocumentBoardRow[]>(
        key,
        (current) =>
          current?.map((b) => ({
            ...b,
            items: b.items.filter((i) => i.document_id !== documentId),
          })),
      );
      const res = await unpinDocument(documentId);
      if ("error" in res) {
        toast.error(res.error);
        if (snapshot) queryClient.setQueryData(key, snapshot);
      }
    },
    [queryClient, key],
  );

  return { pin, unpin };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Utility — relative time string (same shape as the rest of the home).     */
/* ────────────────────────────────────────────────────────────────────────── */

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
