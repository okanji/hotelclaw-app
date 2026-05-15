/**
 * Suspense fallback for the Tasks route. Without it, clicking the Tasks rail
 * icon keeps the previous section's page on screen for the whole server
 * roundtrip (the section sidebar has already switched away). Mirrors the
 * `ClientSideSuspense` fallback inside `TasksBoardRoom` so the loading state
 * doesn't visibly change once the route resolves.
 */
export default function TasksLoading() {
  return (
    <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
      Loading tasks…
    </div>
  );
}
