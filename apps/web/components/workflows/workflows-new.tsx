"use client";

import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { NewWorkflowClient } from "@/app/p/[propertyId]/workflows/new/new-workflow-client";

export function WorkflowsNew({ propertyId }: { propertyId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: "New" },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <PageShell className="px-6 pt-12 pb-12">
          <NewWorkflowClient propertyId={propertyId} />
        </PageShell>
      </div>
    </div>
  );
}
