import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shaped like <TaskDetail> — the task form on the left,
 * the comments panel on the right. Shared by `tasks/[taskId]/loading.tsx` and
 * <TaskRoom>'s pending state.
 */
export function TaskDetailSkeleton() {
  return (
    <div
      className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px]"
      aria-busy="true"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </header>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <Skeleton className="h-40 w-full rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
      <aside className="flex h-full min-h-0 flex-col border-l bg-muted/20">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <div className="flex-1 space-y-4 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-3">
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      </aside>
    </div>
  );
}
