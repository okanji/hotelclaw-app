"use client";

import { notFound } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { workflowDetailQueryOptions } from "@/lib/query/workflow-queries";
import { classifyMode } from "@/lib/workflows/spec";
import { PageHeader } from "@/components/shell/page-header";
import { BuilderShell } from "./builder/builder-shell";

export function WorkflowDetail({
  propertyId,
  workflowId,
}: {
  propertyId: string;
  workflowId: string;
}) {
  const { data } = useSuspenseQuery(workflowDetailQueryOptions(propertyId, workflowId));
  if (!data.workflow) notFound();

  const spec = data.spec;
  const isDurable = spec ? classifyMode(spec) === "durable" : data.workflow.mode === "durable";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: data.workflow.name },
        ]}
      />
      {spec ? (
        // BuilderShell owns its own width + padding so the canvas view can
        // break out of the comfortable reading column (820px) into the full-
        // width workspace it needs.
        <BuilderShell
          propertyId={propertyId}
          workflowId={workflowId}
          initialSpec={spec}
          isDurable={isDurable}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-10 pt-10 pb-12">
            <div className="rounded-lg border border-border/60 bg-muted/15 p-12 text-center">
              <p className="text-[13px] text-muted-foreground">
                This workflow has no spec yet — open it from a template or
                build one with AI.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
