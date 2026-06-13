import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { RunnerImpl } from "./types";

// Entity runners look up the entity_type by name (so workflow configs can
// reference 'room', 'guest', etc. rather than UUIDs).

async function resolveEntityTypeId(
  propertyId: string,
  name: string,
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("entity_types")
    .select("id")
    .eq("property_id", propertyId)
    .eq("name", name)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`entity type "${name}" not found in this property`);
  }
  return data.id;
}

type CreateEntityConfig = {
  entity_type: string;
  data: Record<string, unknown>;
};

export const createEntityRunner: RunnerImpl<
  CreateEntityConfig,
  { entity: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      entity: {
        id: `dry-${ctx.stepId}`,
        entity_type: config.entity_type,
        data: config.data,
      },
    };
  }
  const entityTypeId = await resolveEntityTypeId(ctx.propertyId, config.entity_type);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("entities")
    .insert({
      property_id: ctx.propertyId,
      entity_type_id: entityTypeId,
      data: config.data,
      created_by: ctx.workflowOwnerId,
      source: "workflow",
      source_workflow_id: ctx.workflowId,
      source_workflow_run_id: ctx.runId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create_entity failed: ${error.message}`);
  return { entity: data as Record<string, unknown> };
};

type UpdateEntityConfig = {
  entity_id: string;
  patch: Record<string, unknown>;
};

export const updateEntityRunner: RunnerImpl<
  UpdateEntityConfig,
  { entity: Record<string, unknown> }
> = async ({ config, ctx }) => {
  const supabase = createServiceClient();
  const { data: current, error: readErr } = await supabase
    .from("entities")
    .select("data")
    .eq("id", config.entity_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (readErr || !current) {
    throw new Error(`update_entity: entity not found`);
  }
  const merged = { ...(current.data ?? {}), ...config.patch };
  if (ctx.dryRun) {
    return { entity: { id: config.entity_id, data: merged } };
  }
  const { data, error } = await supabase
    .from("entities")
    .update({ data: merged })
    .eq("id", config.entity_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`update_entity failed: ${error.message}`);
  return { entity: data as Record<string, unknown> };
};

type FindEntityConfig = {
  entity_type: string;
  where?: Record<string, unknown>;
  limit?: number;
};

export const findEntityRunner: RunnerImpl<
  FindEntityConfig,
  { entities: Record<string, unknown>[]; count: number }
> = async ({ config, ctx }) => {
  const entityTypeId = await resolveEntityTypeId(ctx.propertyId, config.entity_type);
  const supabase = createServiceClient();
  let query = supabase
    .from("entities")
    .select("*")
    .eq("property_id", ctx.propertyId)
    .eq("entity_type_id", entityTypeId)
    .limit(config.limit ?? 10);

  // Each `where` key matches against entities.data->>key.
  // Supabase JSONB filter syntax: .filter("data->>key", "eq", value).
  for (const [key, val] of Object.entries(config.where ?? {})) {
    query = query.filter(`data->>${key}`, "eq", String(val));
  }
  const { data, error } = await query;
  if (error) throw new Error(`find_entity failed: ${error.message}`);
  return {
    entities: (data ?? []) as Record<string, unknown>[],
    count: (data ?? []).length,
  };
};

type DeleteEntityConfig = { entity_id: string };

export const deleteEntityRunner: RunnerImpl<
  DeleteEntityConfig,
  { ok: boolean }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { ok: true };
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("entities")
    .delete()
    .eq("id", config.entity_id)
    .eq("property_id", ctx.propertyId);
  if (error) throw new Error(`delete_entity failed: ${error.message}`);
  return { ok: true };
};
