import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { CustomFieldRow, NamedRow } from "./api";

export type Catalogues = {
  spaces: NamedRow[];
  projects: NamedRow[];
  customFields: CustomFieldRow[];
  /** task id → field id → normalised string value. */
  fieldValues: Map<string, Map<string, string>>;
};

const EMPTY: Catalogues = {
  spaces: [],
  projects: [],
  customFields: [],
  fieldValues: new Map(),
};

/** Match web's normalisation so a mobile filter selects the same rows. */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Reference data behind the task filter facets: teams, projects, and the
 * custom-field definitions + values from migration 0080.
 *
 * Read straight from Supabase under the user's RLS rather than through the web
 * API. That's the same thing web's browser client does for these tables — they
 * are plain reference reads with no side effects, unlike the task writes, which
 * must go through the shared mutation layer for notifications and triage.
 */
export function useCatalogues(propertyId: string | undefined): Catalogues {
  const [data, setData] = useState<Catalogues>(EMPTY);

  useEffect(() => {
    if (!propertyId) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;

    (async () => {
      const [spacesRes, projectsRes, fieldsRes, valuesRes] = await Promise.all([
        supabase
          .from("spaces")
          .select("id, name")
          .eq("property_id", propertyId)
          .order("position", { ascending: true }),
        supabase
          .from("projects")
          .select("id, name")
          .eq("property_id", propertyId)
          .order("name", { ascending: true }),
        supabase
          .from("custom_fields")
          .select("id, name, type, options")
          .eq("property_id", propertyId)
          .is("archived_at", null)
          .order("position", { ascending: true }),
        supabase
          .from("task_field_values")
          .select("task_id, field_id, value")
          .eq("property_id", propertyId),
      ]);

      if (cancelled) return;

      const fieldValues = new Map<string, Map<string, string>>();
      for (const row of (valuesRes.data ?? []) as {
        task_id: string;
        field_id: string;
        value: unknown;
      }[]) {
        const perTask = fieldValues.get(row.task_id) ?? new Map();
        perTask.set(row.field_id, normalise(row.value));
        fieldValues.set(row.task_id, perTask);
      }

      // Facets degrade to "absent" rather than breaking the screen — a property
      // with no custom fields, or a failed read, just shows fewer filters.
      setData({
        spaces: (spacesRes.data ?? []) as NamedRow[],
        projects: (projectsRes.data ?? []) as NamedRow[],
        customFields: (fieldsRes.data ?? []) as CustomFieldRow[],
        fieldValues,
      });
    })().catch(() => {
      if (!cancelled) setData(EMPTY);
    });

    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  return data;
}
