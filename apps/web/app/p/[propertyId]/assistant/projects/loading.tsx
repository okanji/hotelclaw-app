import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for the projects gallery, shaped like the real page
 * (masthead + two-column card grid). Without it, this segment is the only
 * kind of sidebar click in the app that commits nothing until the whole
 * server render lands — seconds of a dead screen that reads as a broken
 * link, not a slow one.
 */
export default function AssistantProjectsLoading() {
  return (
    <PageShell className="px-10 py-8">
      <Skeleton className="h-10 w-44" />
      <Skeleton className="mt-3 h-4 w-[420px] max-w-full" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card bg-card p-4 shadow-card">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="mt-3 h-3.5 w-[85%]" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
