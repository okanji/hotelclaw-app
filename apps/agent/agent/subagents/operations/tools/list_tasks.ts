import { defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../../../lib/supabase";
import { resolveTenantCaller } from "../../../lib/tenant";

export default defineTool({
  description:
    "List tasks in this property, optionally filtered by status CATEGORY (todo = not started, in_progress = active, blocked, done = finished). Returns title, status (the list's own status name), priority, due date, last update.",
  inputSchema: z.object({
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    limit: z.number().int().min(1).max(30).default(15),
  }),
  async execute({ status, limit }, ctx) {
    const { propertyId } = await resolveTenantCaller(ctx);
    let query = serviceClient()
      .from("tasks")
      .select("id, title, status, priority, due_at, updated_at, status_ref:statuses!tasks_status_id_fkey(name)")
      .eq("property_id", propertyId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    // The to-one embed comes back as an object; the untyped client infers
    // an array, so normalise either shape.
    const tasks = (data ?? []).map(({ status_ref, ...t }) => {
      const ref = (Array.isArray(status_ref) ? status_ref[0] : status_ref) as
        | { name?: string }
        | null
        | undefined;
      return { ...t, status: ref?.name ?? t.status, status_category: t.status };
    });
    return { count: tasks.length, tasks };
  },
});
