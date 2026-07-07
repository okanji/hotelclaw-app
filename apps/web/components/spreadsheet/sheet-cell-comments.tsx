"use client";

/**
 * Cell comments via Liveblocks Comments.
 *
 * Threads with `metadata.kind = "cell"` are anchored to a `(sheetId, cellId)`
 * pair. The surface subscribes to `useThreads()` ONCE, derives a
 * `cellsWithComments: Set<cellId>` for the active sheet, and passes that to
 * each `<SheetCell>` as a boolean prop. Cells render a static triangle
 * indicator (no per-cell subscription). To read / reply, users open the
 * workbook-wide comments sidebar.
 *
 * Liveblocks Comments billing is already enabled (used by tasks + docs); no
 * server-side wiring needed beyond the existing auth endpoint.
 */

import { useMemo } from "react";
import { Composer, Thread } from "@liveblocks/react-ui";
import { useCreateThread, useThreads } from "@liveblocks/react/suspense";
import type { ThreadData } from "@liveblocks/client";
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type SheetThread = ThreadData<Liveblocks["ThreadMetadata"]>;

/**
 * Convert the workbook's threads into per-cell sets. The surface calls this
 * once and passes the result to each `<SheetCell>` as a boolean prop.
 *
 * Returns the set of `cellId`s (`colId@rowId`) on the **active sheet** that
 * have at least one unresolved thread.
 */
export function useActiveSheetCommentCellIds(
  activeSheetId: string,
): Set<string> {
  const { threads } = useThreads();
  return useMemo(() => {
    const set = new Set<string>();
    for (const t of threads) {
      if (
        t.metadata?.kind === "cell" &&
        t.metadata.sheetId === activeSheetId &&
        t.metadata.cellId &&
        !t.resolved
      ) {
        set.add(t.metadata.cellId);
      }
    }
    return set;
  }, [threads, activeSheetId]);
}

/** Workbook-wide grouping for the sidebar. */
export function useWorkbookThreadsBySheet(): Map<string, SheetThread[]> {
  const { threads } = useThreads();
  return useMemo(() => {
    const map = new Map<string, SheetThread[]>();
    for (const t of threads) {
      if (t.metadata?.kind !== "cell") continue;
      const sheetId = t.metadata.sheetId;
      if (!sheetId) continue;
      const bucket = map.get(sheetId) ?? [];
      bucket.push(t);
      map.set(sheetId, bucket);
    }
    return map;
  }, [threads]);
}

/**
 * Toolbar button: posts a new comment on the currently-selected cell. Empty
 * selection → disabled.
 */
export function NewCellCommentButton({
  sheetId,
  cellId,
}: {
  sheetId: string;
  cellId: string | null;
}) {
  const createThread = useCreateThread();
  const disabled = !cellId;
  return (
    // Popover — NOT DropdownMenu. The Liveblocks Composer is a contenteditable
    // form; Base UI's Menu primitive traps arrow/Tab keys for menu-item
    // navigation, which prevents typing into the composer.
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            title="Insert comment (Cmd+Option+M)"
            className="size-7"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-80 p-0"
      >
        {cellId ? (
          <Composer
            metadata={{ kind: "cell", sheetId, cellId }}
            onComposerSubmit={({ body }, e) => {
              e.preventDefault();
              createThread({
                body,
                metadata: { kind: "cell", sheetId, cellId },
              });
            }}
            autoFocus
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Workbook-wide comments sidebar — opens via the toolbar button. Lists every
 * unresolved thread grouped by sheet. Clicking a thread switches to the
 * right sheet (via `onSwitchToCell`).
 */
export function CommentsSidebarButton({
  sheetTitles,
  onSwitchToCell,
}: {
  sheetTitles: Map<string, string>;
  onSwitchToCell: (sheetId: string, cellId: string) => void;
}) {
  const bySheet = useWorkbookThreadsBySheet();
  const total = useMemo(
    () =>
      Array.from(bySheet.values()).reduce(
        (acc, list) => acc + list.filter((t) => !t.resolved).length,
        0,
      ),
    [bySheet],
  );
  return (
    // Popover — each Thread inside has its own reply composer, which is
    // a contenteditable. Menu primitive would swallow its key events.
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Comments"
            className="h-7 gap-1 px-2 text-xs"
          >
            <MessageSquare className="size-4" />
            {total > 0 ? (
              <span className="tabular-nums">{total}</span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96 p-2">
        <div className="mb-1 text-xs font-medium">Comments</div>
        {total === 0 ? (
          <p className="text-xs text-muted-foreground">
            No open comments. Select a cell and click the comment button to
            add one.
          </p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {Array.from(bySheet.entries()).map(([sheetId, threads]) => {
              const open = threads.filter((t) => !t.resolved);
              if (open.length === 0) return null;
              return (
                <section key={sheetId}>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {sheetTitles.get(sheetId) ?? `Sheet ${sheetId.slice(0, 6)}`}
                  </h3>
                  <div className="space-y-2">
                    {open.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => {
                          if (t.metadata?.cellId) {
                            onSwitchToCell(sheetId, t.metadata.cellId);
                          }
                        }}
                        className="block w-full rounded-md text-left hover:bg-muted"
                      >
                        <Thread
                          thread={t}
                          className="!border-0 !shadow-none"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
