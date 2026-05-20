/**
 * Document detail hard loads are rendered by `<DocumentsSurface>` in the
 * property layout (outside this segment's Suspense boundary). Returning null
 * here avoids stacking a second "Loading…" on top of the editor skeleton while
 * the section layout prefetches.
 */
export default function DocumentDetailLoading() {
  return null;
}
