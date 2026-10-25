import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the cycles timeline: compact header, current-cycle card, rows. */
export default function CyclesLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center px-4">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="w-full max-w-page px-(--page-gutter) pt-2">
        <Skeleton className="h-72 w-full rounded-card" />
        <div className="mt-6 flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
