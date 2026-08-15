import { queryOptions } from "@tanstack/react-query";
import type { WorkflowSpec } from "@/lib/workflows/spec";

// React Query option factories for the workflows surface. Consumers all live
// inside components/workflows/* — server pages return null and let the
// WorkflowsSurface fetch via these.

type WorkflowListItem = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  mode: "instant" | "durable";
  /** The current version's trigger event type (e.g. "task.created"), or null
   *  for workflows with no saved version yet. */
  trigger_event_type: string | null;
  /** Deduped step types from the current version's spec. With the trigger,
   *  this is everything the feature lens (lib/workflows/features.ts) needs to
   *  answer "does this automation touch Docs?" without fetching specs. */
  step_types: string[];
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
};

export function workflowsListQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["workflows", propertyId] as const,
    queryFn: async (): Promise<WorkflowListItem[]> => {
      const res = await fetch(`/api/properties/${propertyId}/workflows`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load workflows");
      const { workflows } = (await res.json()) as { workflows: WorkflowListItem[] };
      return workflows;
    },
  });
}

type WorkflowDetail = {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    mode: "instant" | "durable";
    current_version_id: string | null;
    webhook_token: string | null;
    last_run_at: string | null;
    last_run_status: string | null;
    created_at: string;
    updated_at: string;
  };
  spec: WorkflowSpec | null;
};

export function workflowDetailQueryOptions(propertyId: string, workflowId: string) {
  return queryOptions({
    queryKey: ["workflow", propertyId, workflowId] as const,
    queryFn: async (): Promise<WorkflowDetail> => {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load workflow");
      return (await res.json()) as WorkflowDetail;
    },
  });
}

type WorkflowRun = {
  id: string;
  status: string;
  mode: string;
  trigger_kind: string | null;
  durable_run_id: string | null;
  is_dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

export function workflowRunsQueryOptions(propertyId: string, workflowId: string) {
  return queryOptions({
    queryKey: ["workflow-runs", propertyId, workflowId] as const,
    queryFn: async (): Promise<WorkflowRun[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/runs`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load runs");
      const { runs } = (await res.json()) as { runs: WorkflowRun[] };
      return runs;
    },
  });
}

type PropertyWorkflowRun = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  mode: string;
  trigger_kind: string | null;
  is_dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

export function allPropertyRunsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["all-workflow-runs", propertyId] as const,
    queryFn: async (): Promise<PropertyWorkflowRun[]> => {
      const res = await fetch(`/api/properties/${propertyId}/workflows/runs`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load runs");
      const { runs } = (await res.json()) as { runs: PropertyWorkflowRun[] };
      return runs;
    },
  });
}

type WorkflowRunDetail = {
  run: {
    id: string;
    status: string;
    mode: string;
    trigger_kind: string | null;
    durable_run_id: string | null;
    is_dry_run: boolean;
    started_at: string;
    finished_at: string | null;
    error: string | null;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
  };
  steps: Array<{
    id: string;
    run_id: string;
    step_id: string;
    step_type: string;
    status: string;
    attempt: number;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
    ai_trace: Record<string, unknown> | null;
    started_at: string;
    finished_at: string | null;
  }>;
};

export function workflowRunDetailQueryOptions(
  propertyId: string,
  workflowId: string,
  runId: string,
) {
  return queryOptions({
    queryKey: ["workflow-run", propertyId, workflowId, runId] as const,
    queryFn: async (): Promise<WorkflowRunDetail> => {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/runs/${runId}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load run");
      return (await res.json()) as WorkflowRunDetail;
    },
  });
}

type WorkflowTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  surfaces: string[];
  spec: Record<string, unknown>;
};

export function workflowTemplatesQueryOptions() {
  return queryOptions({
    queryKey: ["workflow-templates"] as const,
    queryFn: async (): Promise<WorkflowTemplate[]> => {
      // Templates are global (RLS: any authenticated user can read). Fetch
      // straight from the table via the supabase client to avoid an extra
      // API route.
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("workflow_templates")
        .select("id, slug, name, description, category, surfaces, spec")
        .order("name", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as WorkflowTemplate[];
    },
  });
}

type EntityType = {
  id: string;
  name: string;
  display_name: string;
  schema: Record<string, unknown> | null;
  display_config: Record<string, unknown> | null;
  created_at: string;
};

export function entityTypesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["entity-types", propertyId] as const,
    queryFn: async (): Promise<EntityType[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/entities/types`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load entity types");
      const { types } = (await res.json()) as { types: EntityType[] };
      return types;
    },
  });
}

type EntityRow = {
  id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function entitiesQueryOptions(propertyId: string, typeName: string) {
  return queryOptions({
    queryKey: ["entities", propertyId, typeName] as const,
    queryFn: async (): Promise<EntityRow[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/entities?type=${encodeURIComponent(typeName)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load entities");
      const { entities } = (await res.json()) as { entities: EntityRow[] };
      return entities;
    },
  });
}
