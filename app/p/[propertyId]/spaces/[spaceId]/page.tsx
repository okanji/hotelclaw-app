import { SpaceDetail } from "@/components/spaces/space-detail";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ propertyId: string; spaceId: string }>;
}) {
  const { propertyId, spaceId } = await params;
  return <SpaceDetail propertyId={propertyId} spaceId={spaceId} />;
}
