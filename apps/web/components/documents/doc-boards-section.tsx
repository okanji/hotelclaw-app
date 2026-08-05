"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { DocPinCard, DocumentPinPicker } from "@/components/documents/doc-pin-card";
import { LABEL_DOT, LABEL_WASH } from "@/components/labels/label-tokens";
import {
  useDocsHomePresenceMap,
} from "@/components/documents/docs-home-presence";
import {
  createBoard,
  deleteBoard,
  pinDocument,
  renameBoard,
  setBoardColor,
  unpinDocument,
} from "./board-actions";

/** Small accent dot in the board header. Matches the DB's color check. */
const COLOR_DOT = LABEL_DOT;
/** Soft tint behind a board's drop-zone, used when a drag is over the strip. */
const COLOR_DROP_TINT: Record<BoardColor, string> = LABEL_WASH;
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
export function DocBoardsSection({
  propertyId,
  pinMode = "drag",
}: {
  propertyId: string;
  /** Dashboard has no doc list to drag from — use search-and-click pinning. */
  pinMode?: "drag" | "picker";
}) {
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
  // The channel name is suffixed with `useId()` so multiple mounted instances
  // (e.g. during the docs-home variant picker, where all options stay in the
  // DOM with `hidden`) don't collide on Supabase's name-keyed channel cache —
  // adding `.on()` after `.subscribe()` on a shared channel throws.
  const instanceId = useId();
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`document-boards:${propertyId}:${instanceId}`)
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
  }, [propertyId, queryClient, instanceId]);

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
    return (
      <EmptyBoardsCallout
        onCreate={handleCreate}
        pending={creatingBoard}
        pinMode={pinMode}
      />
    );
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
      <div className="flex flex-col gap-5">
        {boards.map((board) => (
          <BoardStrip
            key={board.id}
            board={board}
            docsById={docsById}
            docs={docs ?? []}
            propertyId={propertyId}
            pinMode={pinMode}
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
  docs,
  propertyId,
  pinMode,
}: {
  board: DocumentBoardRow;
  docsById: Map<string, DocRow>;
  docs: DocRow[];
  propertyId: string;
  pinMode: "drag" | "picker";
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
    disabled: pinMode === "picker",
  });

  const onBoard = useMemo(
    () => new Set(items.map((i) => i.document_id)),
    [items],
  );
  const pinCandidates = useMemo(
    () =>
      docs
        .filter((d) => !onBoard.has(d.id))
        .map((d) => ({ id: d.id, title: d.title })),
    [docs, onBoard],
  );

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

  const pinPicker = (
    <DocumentPinPicker
      groups={[{ label: "Documents", items: pinCandidates }]}
      onPin={(id) => void pin(id, board.id)}
      disabled={pinCandidates.length === 0}
    />
  );

  const cards = items.map((item) => {
    const doc = docsById.get(item.document_id);
    if (!doc) return null;
    return pinMode === "picker" ? (
      <DocPinCard
        key={doc.id}
        doc={doc}
        propertyId={propertyId}
        accentDotClass={COLOR_DOT[board.color]}
        onUnpin={handleUnpin}
      />
    ) : (
      <DocCard
        key={doc.id}
        doc={doc}
        propertyId={propertyId}
        boardColor={board.color}
        onUnpin={handleUnpin}
      />
    );
  });

  return (
    // No board background (notion-spec-v2 §6, the same rule as a kanban
    // group): the cards ARE the board. The grey trough this used to paint is
    // what made a shelf of pages read as a dashboard panel.
    <div className="group/board rounded-md px-1 pt-2 pb-3">
      <BoardHeader board={board} />
      <div
        ref={pinMode === "drag" ? setNodeRef : undefined}
        className={cn(
          "flex gap-3 overflow-x-auto py-2",
          pinMode === "drag" &&
            isOver &&
            cn("rounded-md", COLOR_DROP_TINT[board.color]),
        )}
      >
        {pinMode === "picker" ? (
          hasItems ? (
            <>
              {cards}
              {pinPicker}
            </>
          ) : (
            <BoardEmptyHint pinMode={pinMode} pinPicker={pinPicker} />
          )
        ) : (
          <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
            {hasItems ? (
              <>
                {cards}
                <DropSlot />
              </>
            ) : (
              <BoardEmptyHint pinMode={pinMode} />
            )}
          </SortableContext>
        )}
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
    <div className="mb-4 flex items-center gap-2">
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
          "min-w-0 flex-1 truncate bg-transparent text-base leading-6 font-semibold text-foreground",
          "outline-none placeholder:text-faint-foreground",
        )}
      />
      <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-sm text-muted-foreground tabular-nums">
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
              <DropdownMenuLabel>Color</DropdownMenuLabel>
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

function BoardEmptyHint({
  pinMode,
  pinPicker,
}: {
  pinMode: "drag" | "picker";
  pinPicker?: React.ReactNode;
}) {
  if (pinMode === "picker" && pinPicker) {
    return (
      // Card FOOTPRINT, well RECIPE: this tile stands in the same strip as
      // `DocCard`, so it takes the 10px card rung (a 6px box beside 10px
      // cards reads as a mistake) — but it is not a page, so it keeps the
      // bare warm ring rather than `shadow-card` (notion-spec-v2 §4/§5).
      <div className="flex min-h-48 flex-1 items-center gap-4 rounded-card bg-card px-4 py-4 shadow-ring">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Pin documents</p>
          <p className="mt-1 max-w-[36ch] text-sm text-pretty text-muted-foreground">
            Search and pin pages your team needs quick access to — no dragging
            required.
          </p>
        </div>
        {pinPicker}
      </div>
    );
  }

  return (
    <div className="flex h-48 min-w-48 flex-1 flex-col items-center justify-center gap-2.5 rounded-card bg-card px-4 text-center shadow-ring">
      <Pin
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-5 text-faint-foreground"
      />
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
  onUnpin: (documentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `card:${doc.id}`,
      data: { type: "card", documentId: doc.id },
    });

  return (
    <DocPinCard
      doc={doc}
      propertyId={propertyId}
      accentDotClass={COLOR_DOT[boardColor]}
      onUnpin={onUnpin}
      draggable
      isDragging={isDragging}
      wrapperRef={setNodeRef}
      wrapperStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
}

/**
 * Trailing drop hint at the end of a non-empty board strip. Same footprint
 * as `DocCard` (`w-40 h-48`) so the row reads as a uniform card grid.
 * Brightens with a label when anything is being dragged.
 */
function DropSlot() {
  const { active } = useDndContext();
  const isDragging = !!active;

  return (
    <div
      aria-hidden="true"
      className={cn(
        // A drop target reads as a fill, never a dashed outline
        // (notion-spec §1 — surfaces separate by fill, not stroke).
        // Same 10px card rung as the `DocCard`s it sits between.
        "flex h-48 w-40 shrink-0 flex-col items-center justify-center gap-1.5 rounded-card transition-colors",
        isDragging
          ? "bg-accent-pressed text-muted-foreground"
          : "text-faint-foreground opacity-0 group-hover/board:bg-accent group-hover/board:opacity-100",
      )}
    >
      <Pin strokeWidth={1.75} className="size-4" />
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
  pinMode,
}: {
  onCreate: () => void;
  pending: boolean;
  pinMode: "drag" | "picker";
}) {
  return (
    <section className="pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            Pin your most-used documents
          </h2>
          <p className="mt-1 max-w-[48ch] text-sm text-pretty text-muted-foreground">
            {pinMode === "picker"
              ? "Create a board, then search and pin documents — everyone on this property sees the same layout."
              : "Create a board and drag documents from the library — everyone on this property sees the same layout."}
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

