import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shaped like <InboxView> — page header + mention rows.
 * Shared by `inbox/loading.tsx` and InboxView's pending state.
 */
export function InboxSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-busy="true">
      {/* Header — mirrors PageHeader (h-11, border-b, px-4). */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-3.5 w-20" />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-lg border border-border p-3"
            >
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-3.5 w-[70%]" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
