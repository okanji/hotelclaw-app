import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback shaped like the two-pane queue, so arrival doesn't jump. */
export default function TriageLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-4">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-full shrink-0 flex-col gap-1 border-r border-border p-2 md:w-[340px]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5 px-2.5 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
        <div className="hidden flex-1 flex-col gap-3 px-6 pt-14 md:flex">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    </div>
  );
}
