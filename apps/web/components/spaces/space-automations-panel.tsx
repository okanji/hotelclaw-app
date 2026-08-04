"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { ArrowUpRight, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * F2 — "which automations touch this team?" A team-scoped lens over the
 * global Workflows section: every workflow whose CURRENT version's spec
 * references this space id (trigger filters, step configs, template vars).
 * Text-match over the spec JSON is deliberate — the spec has no normalized
 * scope column, and a false negative here just means the workflow only shows
 * on the global page.
 */

type ScopedWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
};

function spaceWorkflowsQueryOptions(propertyId: string, spaceId: string) {
  return queryOptions({
    queryKey: ["space-workflows", spaceId] as const,
    queryFn: async (): Promise<ScopedWorkflow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("workflow_versions")
        .select(
          "id, workflow_id, spec, workflows!inner(id, name, enabled, property_id, current_version_id)",
        )
        .eq("workflows.property_id", propertyId);
      if (error) throw new Error(error.message);
      const out: ScopedWorkflow[] = [];
      for (const row of (data ?? []) as unknown as {
        id: string;
        spec: unknown;
        workflows: {
          id: string;
          name: string;
          enabled: boolean;
          current_version_id: string | null;
        };
      }[]) {
        if (row.workflows.current_version_id !== row.id) continue;
        if (!JSON.stringify(row.spec ?? {}).includes(spaceId)) continue;
        out.push({
          id: row.workflows.id,
          name: row.workflows.name,
          enabled: row.workflows.enabled,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 60_000,
  });
}

export function SpaceAutomationsPanel({
  propertyId,
  spaceId,
  spaceName,
}: {
  propertyId: string;
  spaceId: string;
  spaceName: string;
}) {
  const { data: workflows = [], isPending } = useQuery(
    spaceWorkflowsQueryOptions(propertyId, spaceId),
  );

  const prefillHref = useMemo(() => {
    const prefill = encodeURIComponent(
      btoa(JSON.stringify({ goal: `Build an automation for the ${spaceName} team` })),
    );
    return `/p/${propertyId}/workflows/new?prefill=${prefill}`;
  }, [propertyId, spaceName]);

  return (
    <div className="flex flex-col gap-4">
      {isPending ? (
        <p className="text-sm text-muted-foreground">Checking automations…</p>
      ) : workflows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          No automations reference this team yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md bg-muted">
          {workflows.map((w) => (
            <li key={w.id}>
              <Link
                href={`/p/${propertyId}/workflows/${w.id}`}
                className="group flex items-center gap-3 px-4 min-h-[34px] py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <Workflow className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {w.name}
                </span>
                <span
                  className={
                    w.enabled
                      ? "text-xs text-success"
                      : "text-xs text-faint-foreground"
                  }
                >
                  {w.enabled ? "On" : "Off"}
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        render={<Link href={prefillHref} />}
      >
        <Workflow className="size-4" />
        Automate this team
      </Button>
    </div>
  );
}
