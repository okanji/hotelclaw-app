import { InitiativesList } from "@/components/initiatives/initiatives-list";

export default async function InitiativesPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <InitiativesList propertyId={propertyId} />;
}
