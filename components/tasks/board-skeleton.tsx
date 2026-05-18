import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { COLUMNS } from "./kanban";

/** Card counts per column — purely visual, gives the board some texture. */
const CARDS_PER_COLUMN = [3, 2, 1, 2];

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <Skeleton className="h-3.5 w-[78%]" />
      <Skeleton className="h-3 w-[45%]" />
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/**
 * Loading placeholder shaped like <TasksBoard> — page header + four kanban
 * columns. Shared by the route `loading.tsx` and the board's own pending
 * state so a route transition and a cold cache show the same shape.
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

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
        {COLUMNS.map((column, i) => (
          <section
            key={column.id}
            className="flex w-80 shrink-0 flex-col rounded-xl border border-border bg-muted/40"
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className={cn("size-2 rounded-full", column.dotClass)} />
              <Skeleton className="h-3.5 w-20" />
            </header>
            <div className="flex flex-col gap-2 p-2 pt-0">
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
