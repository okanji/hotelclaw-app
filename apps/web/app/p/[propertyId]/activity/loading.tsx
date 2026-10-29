/**
 * Suspense fallback for the Activity route's main pane. The gr8r Inbox
 * (`inbox-view`, mounted by `<ActivitySurface>` in the property layout)
 * hydrates from the prefetched notifications cache and draws its own `.sk`
 * skeleton, so this only covers a cold server roundtrip — deliberately a
 * quiet line, not a second full-page skeleton stacked beside the surface's.
 */
export default function ActivityLoading() {
  return (
    <div
      className="faint flex h-full min-h-0 flex-1 items-center justify-center"
      style={{ padding: 32, fontSize: "var(--g8-fs-sm)" }}
      aria-busy="true"
    >
      Loading your activity…
    </div>
  );
}
