"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { LibraryBig, Sparkles, Workflow } from "lucide-react";
import { workflowDetailQueryOptions } from "@/lib/query/workflow-queries";
import { classifyMode } from "@/lib/workflows/spec";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
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
        // The builder is a canvas surface — BuilderShell owns its own width
        // (PageShell width="bleed") so the graph gets the whole pane.
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
          <PageShell className="px-10 pt-10 pb-12">
            <div className="rounded-lg bg-muted p-12 text-center">
              <Workflow className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                This workflow is empty
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
                Start from a template, or describe what you want and let the AI
                design it.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Link
                  href={`/p/${propertyId}/workflows/new`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  Build with AI
                </Link>
                <Link
                  href={`/p/${propertyId}/workflows/templates`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-card px-2 text-sm font-medium shadow-ring hover:bg-accent"
                >
                  <LibraryBig className="size-3.5" aria-hidden />
                  Browse templates
                </Link>
              </div>
            </div>
          </PageShell>
        </div>
      )}
    </div>
  );
}
