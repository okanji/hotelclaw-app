import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton for narrow auth/invite route segments. Sized for a centered form
 * card — title, two inputs, button — so hard loads don't flash a blank pane
 * while the server component resolves.
 */
export function RouteLoading() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-6 py-12">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <div className="mt-2 space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}
