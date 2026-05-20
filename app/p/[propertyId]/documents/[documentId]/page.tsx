/**
 * Document route landing. The editor is rendered by `<DocumentsSurface>` in
 * `documents/layout.tsx` (it reads the active document from the URL), so this
 * page is `null` and exists only so `/documents/[documentId]` URLs resolve on
 * a hard load / deep link.
 */
export default function DocumentPage() {
  return null;
}
