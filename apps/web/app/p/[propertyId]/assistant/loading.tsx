import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for the assistant workspace, shaped like its home screen
 * (centered headline + hero composer) so arriving from the projects pages
 * commits instantly instead of holding the old page while the server renders.
 *
 * Same-route `?c=` hops (sidebar recents, a project's conversation links) do
 * NOT re-trigger this boundary — verified live: the workspace stays mounted
 * and picks the tab up through `useSearchParams`, which is what keeps its
 * panes' event streams alive. Only cross-segment arrivals show it.
 */
export default function AssistantLoading() {
  return (
    <div data-slot="assistant-loading" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-content px-6 py-14">
        <div className="flex flex-col items-center">
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="mt-3 h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="mt-7 h-32 w-full rounded-card" />
        <Skeleton className="mt-10 h-3.5 w-16" />
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    </div>
  );
}
