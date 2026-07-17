"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, Workflow } from "lucide-react";
import {
  workflowDetailQueryOptions,
  workflowRunsQueryOptions,
} from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";

const STATUS_TONES: Record<
  string,
  React.ComponentProps<typeof StatusBadge>["tone"]
> = {
  succeeded: "success",
  failed: "danger",
  filtered: "neutral",
  running: "info",
  queued: "neutral",
  waiting: "warning",
  cancelled: "neutral",
};

function formatRelative(iso: string | null) {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(start: string, end: string | null) {
  if (!end) return "—";
  const ms = Date.parse(end) - Date.parse(start);
  if (isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

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
        <div className="mx-auto max-w-[820px] px-10 pt-10 pb-12">
          {runs.length > 0 ? (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/p/${propertyId}/workflows/${workflowId}/runs/${r.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
                  >
                    <StatusBadge tone={STATUS_TONES[r.status] ?? "neutral"} dot={false}>
                      {r.status}
                    </StatusBadge>
                    <span className="flex-1 truncate text-sm text-foreground">
                      {r.trigger_kind ?? "manual"}
                    </span>
                    {r.is_dry_run ? (
                      <Badge variant="outline" className="border-border/60 text-muted-foreground">
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
            <div className="rounded-lg border border-border/60 bg-muted/15 p-12 text-center">
              <History className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                No runs yet. Once it’s turned on, this workflow runs automatically
                whenever its trigger happens.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
