import { InitiativeDetail } from "@/components/initiatives/initiative-detail";

export default async function InitiativePage({
  params,
}: {
  params: Promise<{ propertyId: string; initiativeId: string }>;
}) {
  const { propertyId, initiativeId } = await params;
  return (
    <InitiativeDetail
      key={initiativeId}
      propertyId={propertyId}
      initiativeId={initiativeId}
    />
  );
}
