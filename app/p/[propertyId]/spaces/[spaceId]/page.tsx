/**
 * Space route landing. The space workspace is rendered by `<SpacesSurface>` in
 * the property layout (it reads the active space id from the URL), so this page
 * is `null` and exists only so `/spaces/[spaceId]` URLs resolve on a hard load
 * / deep link. Keeping the surface — not this segment — in charge means
 * navigating away (e.g. opening a document) tears the space view down instead
 * of leaving it stacked under the new section.
 */
export default function SpacePage() {
  return null;
}
