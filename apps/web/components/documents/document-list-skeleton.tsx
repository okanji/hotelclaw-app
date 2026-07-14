import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shaped like the documents index — header + a list of
 * document rows. Shared by `<DocumentList>`'s pending state and any route
 * fallback, so a cold cache and a route transition show the same shape.
 */
export function DocumentListSkeleton() {
  return (
    <div
      className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16"
      aria-busy="true"
    >
      <header className="mb-8 flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </header>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-4 w-[55%]" />
            <Skeleton className="ml-auto h-3 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
