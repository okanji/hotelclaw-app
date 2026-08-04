"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { LibraryBig, Sparkles, Workflow } from "lucide-react";
import { workflowDetailQueryOptions } from "@/lib/query/workflow-queries";
import { classifyMode } from "@/lib/workflows/spec";
import { PageHeader } from "@/components/shell/page-header";
import { BuilderShell } from "./builder/builder-shell";
import { WorkflowRoom } from "./builder/workflow-room";

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
        <WorkflowRoom propertyId={propertyId} workflowId={workflowId} initialSpec={spec}>
          <BuilderShell
            propertyId={propertyId}
            workflowId={workflowId}
            initialSpec={spec}
            isDurable={isDurable}
            initialVersionId={data.workflow.current_version_id ?? null}
            webhookToken={data.workflow.webhook_token ?? null}
            enableCoEditing
          />
        </WorkflowRoom>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-10 pt-10 pb-12">
            <div className="rounded-lg bg-muted p-12 text-center">
              <Workflow className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                This workflow is empty
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Start from a template, or describe what you want and let the AI
                design it.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Link
                  href={`/p/${propertyId}/workflows/new`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  Build with AI
                </Link>
                <Link
                  href={`/p/${propertyId}/workflows/templates`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <LibraryBig className="size-3.5" aria-hidden />
                  Browse templates
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
