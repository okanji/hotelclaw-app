"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { ArrowUpRight, Workflow, Zap } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
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
    <section className="panel">
      <div className="panel-h">
        <h2>Automations</h2>
        {!isPending ? <span className="faint">{workflows.length}</span> : null}
        <span className="sp" />
        <Link href={prefillHref} className="btn btn-secondary btn-sm">
          <Gi icon={Workflow} size={14} />
          Automate this team
        </Link>
      </div>
      {isPending ? (
        <div className="panel-b faint">Checking automations…</div>
      ) : workflows.length === 0 ? (
        <G8Empty
          icon={Zap}
          title="No automations yet"
          text="No workflows reference this team. Automate a routine hand-off and it will show up here."
          sm
        />
      ) : (
        workflows.map((w) => (
          <Link key={w.id} href={`/p/${propertyId}/workflows/${w.id}`} className="mini">
            <Gi icon={Workflow} size={14} />
            <span className="tt">{w.name}</span>
            <span className={w.enabled ? "badge green" : "badge gray"}>
              <span className="dot" />
              {w.enabled ? "On" : "Off"}
            </span>
            <Gi icon={ArrowUpRight} size={13} />
          </Link>
        ))
      )}
    </section>
  );
}
