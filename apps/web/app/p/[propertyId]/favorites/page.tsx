import { FavoritesPage } from "@/components/gr8r/favorites-view";

/**
 * `/p/<id>/favorites` — gr8r's Favorites page. A real route (the sidebar's
 * Favorites row links here); the view gates itself on the surface pathname
 * so a pushState hop to another section never leaves it painted underneath.
 */
export default async function Favorites({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <FavoritesPage propertyId={propertyId} />;
}
