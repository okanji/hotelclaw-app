import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Loading placeholder shaped like the documents index — header + a list of
 * document rows. Shared by `<DocumentList>`'s pending state and any route
 * fallback, so a cold cache and a route transition show the same shape.
 */
export function DocumentListSkeleton() {
  return (
    <div
      className="flex h-full w-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16"
      aria-busy="true"
    >
      <PageShell>
        <header className="mb-8 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-8 w-36 rounded-md" />
        </header>
        <ul className="flex flex-col gap-px">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex h-[37px] items-center gap-3 px-2">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-4 w-[55%]" />
              <Skeleton className="ml-auto h-3 w-16" />
            </li>
          ))}
        </ul>
      </PageShell>
    </div>
  );
}
