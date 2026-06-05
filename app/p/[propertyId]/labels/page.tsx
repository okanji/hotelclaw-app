import { LabelsManager } from "@/components/labels/labels-manager";

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <LabelsManager propertyId={propertyId} />;
}
