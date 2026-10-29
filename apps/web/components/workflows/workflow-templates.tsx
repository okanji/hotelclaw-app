"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { workflowTemplatesQueryOptions } from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { WfPage } from "./g8-bits";
import { WorkflowsTabs } from "./workflows-tabs";
import { TemplatesClient } from "@/app/p/[propertyId]/workflows/templates/templates-client";

export function WorkflowTemplates({ propertyId }: { propertyId: string }) {
  const { data: templates } = useSuspenseQuery(workflowTemplatesQueryOptions());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
      />
      <WfPage
        title="Templates"
        lede="Start with a ready-made workflow — pick one to create your own copy, then customize it however you like."
        tabs={<WorkflowsTabs propertyId={propertyId} />}
      >
        <TemplatesClient
          propertyId={propertyId}
          templates={templates as Parameters<typeof TemplatesClient>[0]["templates"]}
        />
      </WfPage>
    </div>
  );
}
