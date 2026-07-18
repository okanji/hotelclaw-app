import { defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../../../lib/supabase";
import { resolveTenantCaller } from "../../../lib/tenant";

export default defineTool({
  description:
    "List tasks in this property, optionally filtered by status. Returns title, status, priority, due date, last update.",
  inputSchema: z.object({
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    limit: z.number().int().min(1).max(30).default(15),
  }),
  async execute({ status, limit }, ctx) {
    const { propertyId } = await resolveTenantCaller(ctx);
    let query = serviceClient()
      .from("tasks")
      .select("id, title, status, priority, due_at, updated_at")
      .eq("property_id", propertyId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data ?? []).length, tasks: data ?? [] };
  },
});
