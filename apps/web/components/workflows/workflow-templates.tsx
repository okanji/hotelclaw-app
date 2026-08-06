"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { workflowTemplatesQueryOptions } from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
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
      <WorkflowsTabs propertyId={propertyId} />
      <div className="flex-1 overflow-y-auto">
        <PageShell className="px-10 pt-10 pb-12">
          {/* The orientation line is a lede — it wraps early for readability.
              It shares the page's left edge like everything else. */}
          <p className="mb-4 max-w-content text-sm text-pretty text-muted-foreground">
            Start with a ready-made workflow — pick one to create your own copy, then
            customize it however you like.
          </p>
          <TemplatesClient
            propertyId={propertyId}
            templates={templates as Parameters<typeof TemplatesClient>[0]["templates"]}
          />
        </PageShell>
      </div>
    </div>
  );
}
