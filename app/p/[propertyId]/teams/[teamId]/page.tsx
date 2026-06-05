import { TeamDetail } from "@/components/teams/team-detail";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ propertyId: string; teamId: string }>;
}) {
  const { propertyId, teamId } = await params;
  return <TeamDetail propertyId={propertyId} teamId={teamId} />;
}
