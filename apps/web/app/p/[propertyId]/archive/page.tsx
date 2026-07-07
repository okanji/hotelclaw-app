import { ArchiveView } from "@/components/projects/archive-view";

export default async function ArchivePage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <ArchiveView propertyId={propertyId} />;
}
