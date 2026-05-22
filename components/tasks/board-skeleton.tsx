import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS } from "./kanban";

/** Card counts per column — purely visual, gives the board some texture. */
const CARDS_PER_COLUMN = [3, 2, 1, 2];

function CardSkeleton() {
  return (
    <div className="rounded-md border border-border/70 bg-card p-2 shadow-xs">
      {/* Header — task id (left), assignee (right) */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-2.5 w-10" />
        <Skeleton className="size-[18px] rounded-full" />
      </div>
      {/* Title row — status icon + title */}
      <div className="mt-1.5 flex items-start gap-1.5">
        <Skeleton className="mt-0.5 size-3.5 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-[88%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </div>
      {/* Description preview */}
      <Skeleton className="mt-1.5 ml-5 h-2.5 w-[70%]" />
      {/* Priority chip */}
      <Skeleton className="mt-1.5 h-5 w-6 rounded-full" />
      {/* Created date */}
      <Skeleton className="mt-1.5 h-2.5 w-24" />
    </div>
  );
}

/**
 * Loading placeholder shaped like <TasksBoard> — page header, toolbar, and
 * four kanban columns. Mirrors the post-redesign chrome so a hard-load shows
 * the same shape the hydrated board will paint into.
 */
export function TasksBoardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-busy="true">
      {/* Header — mirrors PageHeader (h-11, border-b, px-4). */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <Skeleton className="h-7 w-24 rounded-md" />
      </header>

      {/* Toolbar — Linear-style: status pill tabs on the left, view-mode
          icon group + search + filter/sort icons on the right. */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
          <Skeleton className="ml-1 h-7 w-44 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
        {COLUMNS.map((column, i) => (
          <section
            key={column.id}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/30 dark:bg-muted/15"
          >
            <header className="flex h-10 items-center gap-2 px-3">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-4" />
            </header>
            <div className="flex flex-col gap-1.5 px-2 pb-2">
              {Array.from({ length: CARDS_PER_COLUMN[i] ?? 1 }).map((_, j) => (
                <CardSkeleton key={j} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
