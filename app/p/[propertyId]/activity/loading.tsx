/**
 * Suspense fallback for the Activity route's main pane. The notification feed
 * lives in the secondary sidebar (`ActivitySection`); this pane only renders
 * the selected notification's target, so the fallback is just an empty
 * detail pane — matching `ActivityDetail`'s "nothing selected" state and
 * avoiding a flash of the previous page during the server roundtrip.
 */
export default function ActivityLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      Select a notification to view the details.
    </div>
  );
}
