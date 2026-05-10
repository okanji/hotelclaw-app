import { InboxView } from "@/components/chat/inbox/inbox";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <InboxView propertyId={propertyId} />;
}
