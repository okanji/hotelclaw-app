"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, Workflow } from "lucide-react";
import {
  workflowDetailQueryOptions,
  workflowRunsQueryOptions,
} from "@/lib/query/workflow-queries";
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

export function WorkflowRunsList({
  propertyId,
  workflowId,
}: {
  propertyId: string;
  workflowId: string;
}) {
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
      <div className="flex-1 overflow-y-auto">
        <PageShell className="px-10 pt-10 pb-12">
          {runs.length > 0 ? (
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/p/${propertyId}/workflows/${workflowId}/runs/${r.id}`}
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
                    <span className="flex-1 truncate text-sm text-foreground">
                      {r.trigger_kind ?? "manual"}
                    </span>
                    {r.is_dry_run ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        test
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(r.started_at, r.finished_at)}
                    </span>
                    <span className="w-20 text-right text-xs text-muted-foreground">
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
                No runs yet. Once it’s turned on, this workflow runs automatically
                whenever its trigger happens.
              </p>
            </div>
          )}
        </PageShell>
      </div>
    </div>
  );
}
