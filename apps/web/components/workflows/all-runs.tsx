"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, Workflow } from "lucide-react";
import { allPropertyRunsQueryOptions } from "@/lib/query/workflow-queries";
import { useWorkflowsRealtime } from "@/lib/workflows/use-workflows-realtime";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Badge } from "@/components/ui/badge";
import { RunStatusRing } from "@/components/workflows/run-status-ring";
import {
  formatDuration,
  formatRelative,
  runStatusLabelClass,
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
      <WorkflowsTabs propertyId={propertyId} />
      <div className="flex-1 overflow-y-auto">
        <PageShell className="px-10 pt-8 pb-12">
          {runs.length > 0 ? (
            <ul
              role="list"
              className="divide-y divide-border"
            >
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/p/${propertyId}/workflows/${r.workflow_id}/runs/${r.id}`}
                    className="flex h-[37px] items-center gap-3 px-4 hover:bg-accent"
                  >
                    <RunStatusRing status={r.status} />
                    <span
                      className={cn(
                        "w-16 shrink-0 truncate text-xs",
                        runStatusLabelClass(r.status),
                      )}
                    >
                      {r.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {r.workflow_name}
                    </span>
                    {r.is_dry_run ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        test
                      </Badge>
                    ) : null}
                    <span className="hidden w-28 truncate text-xs text-muted-foreground sm:block">
                      {r.trigger_kind ?? "manual"}
                    </span>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(r.started_at, r.finished_at)}
                    </span>
                    <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                      {formatRelative(r.started_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-muted p-12 text-center">
              <History className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                No runs yet across any workflow. Enable a workflow and trigger it
                to see runs here.
              </p>
            </div>
          )}
        </PageShell>
      </div>
    </div>
  );
}
