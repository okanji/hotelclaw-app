"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, Workflow } from "lucide-react";
import { allPropertyRunsQueryOptions } from "@/lib/query/workflow-queries";
import { useWorkflowsRealtime } from "@/lib/workflows/use-workflows-realtime";
import { runStatusLabel, triggerLabel } from "@/lib/workflows/summary";
import { PageHeader } from "@/components/shell/page-header";
import { RunBadge, WfEmpty, WfPage } from "./g8-bits";
import { RunStatusRing } from "@/components/workflows/run-status-ring";
import {
  formatDuration,
  formatRelative,
} from "@/components/workflows/run-format";
import { WorkflowsTabs } from "./workflows-tabs";

export function AllRunsList({ propertyId }: { propertyId: string }) {
  useWorkflowsRealtime(propertyId);
  const { data: runs } = useSuspenseQuery(allPropertyRunsQueryOptions(propertyId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
      />
      <WfPage
        title="Runs"
        lede="Every workflow run in this property, newest first."
        tabs={<WorkflowsTabs propertyId={propertyId} />}
      >
        {runs.length > 0 ? (
          <ul role="list" className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/p/${propertyId}/workflows/${r.workflow_id}/runs/${r.id}`}
                  className="nrow"
                  style={{ alignItems: "center", padding: "8px 14px" }}
                >
                  <RunStatusRing status={r.status} />
                  <span style={{ width: 92, flexShrink: 0 }}>
                    <RunBadge status={r.status} label={runStatusLabel(r.status)} />
                  </span>
                  <span className="trunc grow" style={{ fontWeight: 500 }}>
                    {r.workflow_name}
                  </span>
                  {r.is_dry_run ? <span className="badge gray">test</span> : null}
                  <span className="trunc muted hidden sm:block" style={{ width: 192, fontSize: 12 }}>
                    {triggerLabel(r.trigger_kind) ?? "Manual run"}
                  </span>
                  <span className="faint num" style={{ width: 48, textAlign: "right", fontSize: 12 }}>
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
            No runs yet across any workflow. Enable a workflow and trigger it to see runs here.
          </WfEmpty>
        )}
      </WfPage>
    </div>
  );
}
