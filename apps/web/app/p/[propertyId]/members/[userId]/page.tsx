import { MemberProfilePage } from "@/components/gr8r/members-profile";

/** `/p/<id>/members/<userId>` — gr8r's member profile (`pageMember`). */
export default async function MemberProfileRoute({
  params,
}: {
  params: Promise<{ propertyId: string; userId: string }>;
}) {
  const { propertyId } = await params;
  return <MemberProfilePage propertyId={propertyId} />;
}
