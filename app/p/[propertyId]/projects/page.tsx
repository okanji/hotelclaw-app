import { Suspense } from "react";
import { ProjectsIndex } from "@/components/projects/projects-index";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  // ProjectsIndex reads `?team=` via useSearchParams — wrap in Suspense.
  return (
    <Suspense fallback={null}>
      <ProjectsIndex propertyId={propertyId} />
    </Suspense>
  );
}
