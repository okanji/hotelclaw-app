import { requireUser } from "@/lib/auth/session";
import { ActivityView } from "@/components/shell/activity/activity-view";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();
  return <ActivityView propertyId={propertyId} userId={user.id} />;
}
