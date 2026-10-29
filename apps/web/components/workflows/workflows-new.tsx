"use client";

import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { WfPage } from "./g8-bits";
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
      <WfPage
        title="Describe what you want"
        lede="Type a goal in plain English — AI designs the workflow across your property’s tasks, chat, docs, meetings, calendar, forms, and entities."
        narrow
      >
        <NewWorkflowClient propertyId={propertyId} />
      </WfPage>
    </div>
  );
}
