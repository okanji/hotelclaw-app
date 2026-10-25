import { Skeleton } from "@/components/ui/skeleton";

/** Generic cycle skeleton while the detail page loads. */
export default function CycleDetailLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="h-11 shrink-0" />
      <div className="w-full max-w-page px-(--page-gutter) pt-8">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="mt-3 h-4 w-80" />
        <Skeleton className="mt-10 h-72 w-full rounded-card" />
        <div className="mt-6 flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
