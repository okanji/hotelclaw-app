"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Sparkles, Workflow } from "lucide-react";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";

export function WorkflowsList({ propertyId }: { propertyId: string }) {
  const { data: workflows } = useSuspenseQuery(workflowsListQueryOptions(propertyId));
  const has = workflows.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
        actions={
          <Link
            href={`/p/${propertyId}/workflows/new`}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            <Sparkles className="size-3.5" />
            New workflow
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-10 pt-10 pb-12">
          {has ? (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {workflows.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/p/${propertyId}/workflows/${w.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                  >
                    <span
                      className={
                        "inline-flex size-1.5 rounded-full " +
                        (w.enabled ? "bg-emerald-500" : "bg-muted-foreground/30")
                      }
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-[13px] font-medium text-foreground">
                      {w.name}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {w.mode}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState propertyId={propertyId} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ propertyId }: { propertyId: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 p-12 text-center">
      <Workflow className="mx-auto mb-4 size-8 text-muted-foreground/70" aria-hidden />
      <h2 className="text-[15px] font-semibold text-foreground">
        Automate anything in your property
      </h2>
      <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-relaxed text-muted-foreground">
        Describe what you want and AI will build it. Workflows can react to
        tasks, chat, docs, meetings, calendar, and your own entities — and
        run instantly or wait for events.
      </p>
      <Link
        href={`/p/${propertyId}/workflows/new`}
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[13px] font-medium text-background hover:opacity-90"
      >
        <Sparkles className="size-4" />
        Build with AI
      </Link>
    </div>
  );
}
