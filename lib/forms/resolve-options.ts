import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { WorkbookSnapshot } from "@/lib/spreadsheet/snapshot";
import type { FormFieldSource } from "@/lib/forms/schema";

/**
 * Live option resolution for data-connected choice fields (`field.source`).
 *
 * Every resolver is fail-soft: bad input, a missing document, or a query
 * error returns `[]` (or an empty map) rather than throwing, so a broken
 * source never takes down a form render or submission. Tenant scoping is
 * enforced here with explicit `property_id` filters on every query.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type ResolvedOption = { id: string; label: string };

const SHEET_OPTION_CAP = 500;
const TASK_OPTION_CAP = 200;

export async function resolveSourceOptions(
  supabase: ServerClient,
  propertyId: string,
  source: FormFieldSource,
): Promise<ResolvedOption[]> {
  try {
    switch (source.kind) {
      case "members": {
        // Two queries instead of a relational join — memberships' FK points
        // at auth.users, not profiles (see /api/properties/.../members).
        const { data: members, error } = await supabase
          .from("memberships")
          .select("user_id")
          .eq("property_id", propertyId);
        if (error || !members || members.length === 0) return [];
        const userIds = members.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        const nameById = new Map(
          (profiles ?? []).map((p) => [p.id, p.full_name] as const),
        );
        return userIds.map((id) => ({
          id,
          label: nameById.get(id) ?? "Member",
        }));
      }
      case "projects": {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("property_id", propertyId)
          .is("archived_at", null)
          .order("position");
        return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
      }
      case "spaces": {
        const { data } = await supabase
          .from("spaces")
          .select("id, name")
          .eq("property_id", propertyId)
          .is("archived_at", null)
          .order("position");
        return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
      }
      case "labels": {
        const { data } = await supabase
          .from("labels")
          .select("id, name")
          .eq("property_id", propertyId)
          .order("name");
        return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
      }
      case "tasks": {
        const { data } = await supabase
          .from("tasks")
          .select("id, title")
          .eq("property_id", propertyId)
          .order("updated_at", { ascending: false })
          .limit(TASK_OPTION_CAP);
        return (data ?? []).map((r) => ({ id: r.id, label: r.title }));
      }
      case "sheet_column":
        return await resolveSheetColumnOptions(supabase, propertyId, source);
      default:
        return [];
    }
  } catch (err) {
    console.error("[forms] resolveSourceOptions failed", source.kind, err);
    return [];
  }
}

/**
 * Resolve raw answer ids → display labels for sourced fields. For
 * sheet_column the stored id IS the cell value (sheet rows have no stable
 * identity), so it's an identity map; otherwise only the selected ids are
 * queried.
 */
export async function resolveLabels(
  supabase: ServerClient,
  propertyId: string,
  source: FormFieldSource,
  ids: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (ids.length === 0) return labels;
  try {
    switch (source.kind) {
      case "sheet_column": {
        for (const id of ids) labels.set(id, id);
        return labels;
      }
      case "members": {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        for (const p of data ?? []) labels.set(p.id, p.full_name ?? "Member");
        return labels;
      }
      case "projects": {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("property_id", propertyId)
          .in("id", ids);
        for (const r of data ?? []) labels.set(r.id, r.name);
        return labels;
      }
      case "spaces": {
        const { data } = await supabase
          .from("spaces")
          .select("id, name")
          .eq("property_id", propertyId)
          .in("id", ids);
        for (const r of data ?? []) labels.set(r.id, r.name);
        return labels;
      }
      case "labels": {
        const { data } = await supabase
          .from("labels")
          .select("id, name")
          .eq("property_id", propertyId)
          .in("id", ids);
        for (const r of data ?? []) labels.set(r.id, r.name);
        return labels;
      }
      case "tasks": {
        const { data } = await supabase
          .from("tasks")
          .select("id, title")
          .eq("property_id", propertyId)
          .in("id", ids);
        for (const r of data ?? []) labels.set(r.id, r.title);
        return labels;
      }
      default:
        return labels;
    }
  } catch (err) {
    console.error("[forms] resolveLabels failed", source.kind, err);
    return labels;
  }
}

/**
 * Columns of a sheet document's first sheet, labeled by the header-row cell
 * text (by convention the first row is the header). Powers the builder's
 * column picker.
 */
export async function resolveSheetColumns(
  supabase: ServerClient,
  propertyId: string,
  documentId: string,
): Promise<ResolvedOption[]> {
  try {
    const sheet = await loadFirstSheet(supabase, propertyId, documentId);
    if (!sheet) return [];
    const headerRowId = sheet.rows[0]?.id;
    return sheet.columns.map((col, index) => {
      const header = headerRowId
        ? (sheet.cells[`${col.id}@${headerRowId}`] ?? "").trim()
        : "";
      return { id: col.id, label: header || `Column ${index + 1}` };
    });
  } catch (err) {
    console.error("[forms] resolveSheetColumns failed", err);
    return [];
  }
}

async function resolveSheetColumnOptions(
  supabase: ServerClient,
  propertyId: string,
  source: FormFieldSource,
): Promise<ResolvedOption[]> {
  if (!source.documentId || !source.column) return [];
  const sheet = await loadFirstSheet(supabase, propertyId, source.documentId);
  if (!sheet) return [];
  const col = sheet.columns.find((c) => c.id === source.column);
  if (!col) return [];

  const options: ResolvedOption[] = [];
  const seen = new Set<string>();
  // Skip the first row — it's the header by convention. Sheet rows have no
  // stable meaning as ids, so the cell value is both id and label.
  for (const row of sheet.rows.slice(1)) {
    const value = (sheet.cells[`${col.id}@${row.id}`] ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ id: value, label: value });
    if (options.length >= SHEET_OPTION_CAP) break;
  }
  return options;
}

/** Fetch a sheet document's snapshot and return its first sheet, or null. */
async function loadFirstSheet(
  supabase: ServerClient,
  propertyId: string,
  documentId: string,
): Promise<WorkbookSnapshot["sheets"][number] | null> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("sheet_state")
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .eq("kind", "sheet")
    .maybeSingle();
  if (error || !doc?.sheet_state) return null;

  // sheet_state is webhook-written JSON; parse defensively.
  const snapshot = doc.sheet_state as Partial<WorkbookSnapshot>;
  const sheet = Array.isArray(snapshot.sheets) ? snapshot.sheets[0] : null;
  if (
    !sheet ||
    !Array.isArray(sheet.columns) ||
    !Array.isArray(sheet.rows) ||
    typeof sheet.cells !== "object" ||
    sheet.cells === null
  ) {
    return null;
  }
  return sheet;
}
