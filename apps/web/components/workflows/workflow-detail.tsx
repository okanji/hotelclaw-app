"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, LibraryBig, Sparkles, Workflow } from "lucide-react";
import { workflowDetailQueryOptions } from "@/lib/query/workflow-queries";
import { classifyMode } from "@/lib/workflows/spec";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { WfEmpty, WfPage } from "./g8-bits";
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
        actions={
          <Link
            href={`/p/${propertyId}/workflows/${workflowId}/runs`}
            className="btn btn-ghost btn-sm"
          >
            <Gi icon={History} size={14} />
            Runs
          </Link>
        }
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
            initialEnabled={data.workflow.enabled ?? false}
            enableCoEditing
          />
        </WorkflowRoom>
      ) : (
        <WfPage title={data.workflow.name} narrow>
          <WfEmpty
            icon={Workflow}
            title="This workflow is empty"
            actions={
              <>
                <Link href={`/p/${propertyId}/workflows/new`} className="btn btn-primary btn-sm">
                  <Gi icon={Sparkles} size={14} />
                  Build with AI
                </Link>
                <Link
                  href={`/p/${propertyId}/workflows/templates`}
                  className="btn btn-secondary btn-sm"
                >
                  <Gi icon={LibraryBig} size={14} />
                  Browse templates
                </Link>
              </>
            }
          >
            Start from a template, or describe what you want and let the AI design it.
          </WfEmpty>
        </WfPage>
      )}
    </div>
  );
}
