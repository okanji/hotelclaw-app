import { MembersPage } from "@/components/gr8r/members-view";

/**
 * `/p/<id>/members` — gr8r's Members page (the sidebar's Members row). The
 * view gates itself on the surface pathname so a pushState hop to another
 * section never leaves it painted underneath.
 */
export default async function Members({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <MembersPage propertyId={propertyId} />;
}
