import { ProjectDetail } from "@/components/projects/project-detail";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ propertyId: string; projectId: string }>;
}) {
  const { propertyId, projectId } = await params;
  return <ProjectDetail propertyId={propertyId} projectId={projectId} />;
}
