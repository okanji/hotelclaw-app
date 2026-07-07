/**
 * Inbox landing. The view is rendered by `<InboxSurface>` in the property
 * layout (it reads the active URL); the mentions prefetch lives in
 * `inbox/layout.tsx`. This page is `null` and exists only so the `/inbox`
 * URL resolves on a hard load / deep link.
 */
export default function InboxPage() {
  return null;
}
