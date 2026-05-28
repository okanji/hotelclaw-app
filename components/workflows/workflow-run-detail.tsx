"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import {
  workflowDetailQueryOptions,
  workflowRunDetailQueryOptions,
} from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { RunInspectorClient } from "@/app/p/[propertyId]/workflows/[workflowId]/runs/[runId]/run-inspector-client";

export function WorkflowRunDetail({
  propertyId,
  workflowId,
  runId,
}: {
  propertyId: string;
  workflowId: string;
  runId: string;
}) {
  const { data: detail } = useSuspenseQuery(workflowDetailQueryOptions(propertyId, workflowId));
  const { data: runData } = useSuspenseQuery(
    workflowRunDetailQueryOptions(propertyId, workflowId, runId),
  );
  const workflow = detail.workflow;
  const run = runData.run;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: workflow.name, href: `/p/${propertyId}/workflows/${workflowId}` },
          { label: "Runs", href: `/p/${propertyId}/workflows/${workflowId}/runs` },
          { label: run.id.slice(0, 8) },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-10 pt-10 pb-12">
          <RunInspectorClient
            propertyId={propertyId}
            workflowId={workflowId}
            initialRun={run as Parameters<typeof RunInspectorClient>[0]["initialRun"]}
            initialSteps={runData.steps as Parameters<typeof RunInspectorClient>[0]["initialSteps"]}
          />
        </div>
      </div>
    </div>
  );
}
