"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, Workflow } from "lucide-react";
import {
  workflowDetailQueryOptions,
  workflowRunsQueryOptions,
} from "@/lib/query/workflow-queries";
import { useWorkflowsRealtime } from "@/lib/workflows/use-workflows-realtime";
import { runStatusLabel, triggerLabel } from "@/lib/workflows/summary";
import { PageHeader } from "@/components/shell/page-header";
import { RunBadge, WfEmpty, WfPage } from "./g8-bits";
import { RunStatusRing } from "@/components/workflows/run-status-ring";
import {
  formatDuration,
  formatRelative,
} from "@/components/workflows/run-format";

export function WorkflowRunsList({
  propertyId,
  workflowId,
}: {
  propertyId: string;
  workflowId: string;
}) {
  useWorkflowsRealtime(propertyId);
  const { data: detail } = useSuspenseQuery(workflowDetailQueryOptions(propertyId, workflowId));
  const { data: runs } = useSuspenseQuery(workflowRunsQueryOptions(propertyId, workflowId));
  const workflow = detail.workflow;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: workflow.name, href: `/p/${propertyId}/workflows/${workflowId}` },
          { label: "Runs" },
        ]}
      />
      <WfPage
        title="Runs"
        lede={workflow.name}
        acts={
          <Link href={`/p/${propertyId}/workflows/${workflowId}`} className="btn btn-secondary">
            Open builder
          </Link>
        }
      >
        {runs.length > 0 ? (
          <ul role="list" className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/p/${propertyId}/workflows/${workflowId}/runs/${r.id}`}
                  className="nrow"
                  style={{ alignItems: "center", padding: "8px 14px" }}
                >
                  <RunStatusRing status={r.status} />
                  <span style={{ width: 92, flexShrink: 0 }}>
                    <RunBadge status={r.status} label={runStatusLabel(r.status)} />
                  </span>
                  <span className="trunc grow">
                    {triggerLabel(r.trigger_kind) ?? "Manual run"}
                  </span>
                  {r.is_dry_run ? <span className="badge gray">test</span> : null}
                  <span className="faint num" style={{ fontSize: 12 }}>
                    {formatDuration(r.started_at, r.finished_at)}
                  </span>
                  <span className="faint num" style={{ width: 80, textAlign: "right", fontSize: 12 }}>
                    {formatRelative(r.started_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <WfEmpty icon={History} title="No runs yet">
            Once it’s turned on, this workflow runs automatically whenever its trigger happens.
          </WfEmpty>
        )}
      </WfPage>
    </div>
  );
}
