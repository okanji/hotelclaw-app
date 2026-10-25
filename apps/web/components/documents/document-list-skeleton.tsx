import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Loading placeholder shaped like the documents index — compact header,
 * the toolbar, and a list of
 * document rows. Shared by `<DocumentList>`'s pending state and any route
 * fallback, so a cold cache and a route transition show the same shape.
 */
export function DocumentListSkeleton() {
  return (
    <div className="flex h-full w-full flex-col" aria-busy="true">
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-28 rounded-md" />
      </div>
      <PageShell className="pt-4">
        <Skeleton className="mb-6 h-8 w-full max-w-sm rounded-md" />
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
