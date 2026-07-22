import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  CustomFieldOption,
  CustomFieldType,
  CustomFieldValue,
} from "@/lib/db/types";

// React Query option factories for task custom fields (migration 0080).
// Definitions are property-wide (fetched once per property); values are
// per-task. Both invalidate through the field actions.

export type CustomFieldRow = {
  id: string;
  space_id: string | null;
  name: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  position: number;
};

export function customFieldsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["custom-fields", propertyId] as const,
    queryFn: async (): Promise<CustomFieldRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("custom_fields")
        .select("id, space_id, name, type, options, position")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as CustomFieldRow[];
    },
    staleTime: 60_000,
  });
}

export type TaskFieldValueRow = {
  field_id: string;
  value: CustomFieldValue;
};

/**
 * Every field value in the property, for the board's field filters. One row
 * per (task, field) that actually has a value — a property with 200 tasks and
 * 3 fields tops out in the low hundreds of rows, so a single fetch beats
 * per-task queries. Backed by the property index from migration 0080.
 */
export function propertyTaskFieldValuesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["task-field-values-property", propertyId] as const,
    queryFn: async (): Promise<
      { task_id: string; field_id: string; value: CustomFieldValue }[]
    > => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("task_field_values")
        .select("task_id, field_id, value")
        .eq("property_id", propertyId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export function taskFieldValuesQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: ["task-field-values", taskId] as const,
    queryFn: async (): Promise<TaskFieldValueRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("task_field_values")
        .select("field_id, value")
        .eq("task_id", taskId);
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskFieldValueRow[];
    },
    staleTime: 30_000,
  });
}
