/**
 * Suspense fallback for the Activity route's main pane (the inbox feed). The
 * feed hydrates from the prefetched notifications cache, so this only shows
 * during a cold server roundtrip — a quiet placeholder, not a skeleton.
 */
export default function ActivityLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      Loading your activity…
    </div>
  );
}
