import { ChevronRight, ListChecks } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Loading placeholder shaped like <TaskDetail> — breadcrumb header, main
 * content on the left, properties sidebar on the right.
 */
export function TaskDetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-4 text-sm text-muted-foreground">
        <ListChecks className="size-4" />
        <span>Tasks</span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <Skeleton className="h-4 w-14" />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <PageShell className="px-10 pt-16 pb-12">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="mt-4 h-4 w-full max-w-md" />
            {/* Inline properties strip */}
            <div className="mt-5 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-20" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-6 w-20 rounded-md" />
                    <Skeleton className="h-6 w-24 rounded-md" />
                    {i === 0 ? <Skeleton className="h-6 w-16 rounded-md" /> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-1">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="size-7 rounded-md" />
            </div>
            <Skeleton className="mt-5 h-4 w-28" />
            <div className="mt-10 border-t border-border pt-6">
              <div className="mb-4 flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
              <Skeleton className="mb-4 h-4 w-48" />
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex gap-2">
                    <Skeleton className="size-7 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
              <Skeleton className="mt-4 h-16 w-full rounded-md" />
            </div>
            </PageShell>
          </div>
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b border-border px-3 py-3">
              <Skeleton className="h-3.5 w-24" />
              <div className="mt-2 space-y-1">
                {Array.from({ length: i === 0 ? 6 : 3 }).map((__, j) => (
                  <Skeleton key={j} className="h-7 w-full rounded-md" />
                ))}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
