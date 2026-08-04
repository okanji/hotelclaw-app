import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton for narrow auth/invite route segments — title, two inputs, button
 * — so hard loads don't flash a blank pane while the server component
 * resolves. Deliberately not a card: no ring, no fill, no shadow, just the
 * bars where the real controls land. Bar heights track the real control
 * ladder (28px input/button, 16px title, 14px body) so nothing jumps when
 * the content swaps in.
 */
export function RouteLoading() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-24" />
      </div>
    </div>
  );
}
