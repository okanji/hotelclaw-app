import { RouteGate } from "@/components/gr8r/route-gate";
import { ArchiveView } from "@/components/gr8r/archive-view";

export default async function ArchivePage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return (
    <RouteGate segment="archive">
      <ArchiveView propertyId={propertyId} />
    </RouteGate>
  );
}
