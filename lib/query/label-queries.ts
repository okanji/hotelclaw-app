import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { EntityColor } from "@/lib/db/types";

/** A label from the shared catalog — the same label can tag tasks and docs. */
export type LabelRow = {
  id: string;
  property_id: string;
  name: string;
  color: EntityColor;
};

/** The property's full label catalog (name + color), alphabetical. */
export function labelsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["labels", propertyId] as const,
    queryFn: async (): Promise<LabelRow[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("labels")
        .select("id, property_id, name, color")
        .eq("property_id", propertyId)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as LabelRow[];
    },
  });
}

/** Labels applied to one document (two-step to dodge nested-join typing). */
export function documentLabelsQueryOptions(
  propertyId: string,
  documentId: string,
) {
  return queryOptions({
    queryKey: ["document-labels", propertyId, documentId] as const,
    queryFn: async (): Promise<LabelRow[]> => {
      const supabase = createBrowserClient();
      const { data: links, error } = await supabase
        .from("document_labels")
        .select("label_id")
        .eq("document_id", documentId);
      if (error) throw new Error(error.message);
      const ids = (links ?? []).map((l) => l.label_id);
      if (ids.length === 0) return [];
      const { data, error: labelsError } = await supabase
        .from("labels")
        .select("id, property_id, name, color")
        .in("id", ids)
        .order("name", { ascending: true });
      if (labelsError) throw new Error(labelsError.message);
      return (data ?? []) as LabelRow[];
    },
  });
}
