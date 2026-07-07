/**
 * The route for a document. Single chokepoint for building doc URLs — every
 * link, redirect, and deep link should go through it instead of hand-assembling
 * `/p/{propertyId}/documents/{documentId}`.
 */
export function documentHref(propertyId: string, documentId: string): string {
  return `/p/${propertyId}/documents/${documentId}`;
}
