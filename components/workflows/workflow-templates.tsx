"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { workflowTemplatesQueryOptions } from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { TemplatesClient } from "@/app/p/[propertyId]/workflows/templates/templates-client";

export function WorkflowTemplates({ propertyId }: { propertyId: string }) {
  const { data: templates } = useSuspenseQuery(workflowTemplatesQueryOptions());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: "Templates" },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-10 pt-10 pb-12">
          <p className="mb-4 text-[12px] text-muted-foreground">
            Fork a starting point — every template is editable in the builder
            once forked.
          </p>
          <TemplatesClient
            propertyId={propertyId}
            templates={templates as Parameters<typeof TemplatesClient>[0]["templates"]}
          />
        </div>
      </div>
    </div>
  );
}
