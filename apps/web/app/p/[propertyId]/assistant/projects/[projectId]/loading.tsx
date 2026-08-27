import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for a project home, mirroring `ProjectDetail`'s frame:
 * breadcrumb, icon-above-title masthead, then the composer column beside the
 * instructions rail. Same reason as the gallery's fallback — the navigation
 * must commit on click, not after the server render.
 */
export default function AssistantProjectLoading() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-workspace px-10 py-8">
        <Skeleton className="h-4 w-40" />
        <div className="mt-5">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="mt-3 h-11 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="@container mt-8">
          <div className="grid gap-10 @3xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <Skeleton className="h-28 w-full rounded-card" />
              <Skeleton className="mt-8 h-4 w-20" />
              <div className="mt-3 flex flex-col gap-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-24 w-full rounded-card" />
              <Skeleton className="h-24 w-full rounded-card" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
