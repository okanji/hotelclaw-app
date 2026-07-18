import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../lib/supabase";
import { resolveSessionAgent } from "../lib/agent-config";

// The executor side of AGENT_TOOL_CATALOG (apps/web/lib/agents/schema.ts —
// keep the id sets in sync; the UI describes exactly what can be granted
// here). Tools are built per session from the selected agent's `tools`
// grants: an ungranted capability does not exist for the model at all.
//
// eve constraint: every `execute` must be written INLINE in its defineTool
// call — the bundler reconstructs executes from stored closure variables on
// replay and does not detect `execute: helperFn`.

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const resolved = await resolveSessionAgent(ctx);
      if (!resolved) return null;
      const { caller, config } = resolved;
      const propertyId = caller.propertyId;
      const userId = caller.userId;
      const grants = new Set(config.tools);
      const resourceIds = config.resources.documentIds;

      const tools: Record<string, ReturnType<typeof defineTool>> = {};

      if (grants.has("list_open_tasks")) {
        tools.list_open_tasks = defineTool({
          description:
            "List open tasks (not done) in this property. Returns count and tasks (title, status, priority, due, assignee). If empty, say so plainly — don't fabricate.",
          inputSchema: z.object({
            status: z.enum(["todo", "in_progress", "blocked"]).optional(),
            limit: z.number().int().min(1).max(20).default(10),
          }),
          async execute({ status, limit }) {
            const supabase = serviceClient();
            let query = supabase
              .from("tasks")
              .select("id, title, status, priority, due_at, assignee_id")
              .eq("property_id", propertyId)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (status) query = query.eq("status", status);
            else query = query.neq("status", "done");
            const { data: tasks, error } = await query;
            if (error) return { error: error.message };

            const assigneeIds = Array.from(
              new Set(
                (tasks ?? [])
                  .map((t) => t.assignee_id)
                  .filter((id): id is string => !!id),
              ),
            );
            const nameById = new Map<string, string>();
            if (assigneeIds.length > 0) {
              const { data: profiles } = await supabase
                .from("profiles")
                .select("id, full_name")
                .in("id", assigneeIds);
              for (const p of profiles ?? []) {
                if (p.full_name) nameById.set(p.id, p.full_name);
              }
            }
            return {
              count: (tasks ?? []).length,
              tasks: (tasks ?? []).map((t) => ({
                id: t.id,
                title: t.title,
                status: STATUS_LABELS[t.status] ?? t.status,
                priority: t.priority,
                due: t.due_at,
                assignee: t.assignee_id
                  ? (nameById.get(t.assignee_id) ?? null)
                  : null,
              })),
            };
          },
        });
      }

      if (grants.has("create_task")) {
        tools.create_task = defineTool({
          description:
            "Create a task in this property's board. Use only when the user asks for work to be filed or you were instructed to file follow-ups. Returns the new task's id and title.",
          inputSchema: z.object({
            title: z.string().min(3).max(200),
            description: z.string().max(2000).optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
          }),
          async execute({ title, description, priority }) {
            const { data, error } = await serviceClient()
              .from("tasks")
              .insert({
                property_id: propertyId,
                title,
                description: description ?? null,
                priority,
                status: "todo",
                source: "ai",
                created_by: userId,
              })
              .select("id, title")
              .single();
            if (error) return { error: error.message };
            return { created: true, task: data };
          },
        });
      }

      if (grants.has("search_documents")) {
        tools.search_documents = defineTool({
          description:
            "Full-text search over the property's documents. Returns title + short preview per match — synthesize from the previews and cite doc titles. If count is 0, say no matching docs exist.",
          inputSchema: z.object({
            query: z.string().min(1).max(200),
            limit: z.number().int().min(1).max(10).default(5),
          }),
          async execute({ query, limit }) {
            const { data, error } = await serviceClient().rpc(
              "search_documents_keyword",
              {
                property_id_param: propertyId,
                query_text: query,
                match_count: limit,
              },
            );
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              results: (data ?? []).map(
                (r: { id: string; title: string; preview: string }) => ({
                  id: r.id,
                  title: r.title,
                  preview: r.preview,
                }),
              ),
            };
          },
        });
      }

      if (grants.has("list_upcoming_meetings")) {
        tools.list_upcoming_meetings = defineTool({
          description:
            "List meetings scheduled in this property in the next N days (title, start, end, location). Times are ISO 8601.",
          inputSchema: z.object({
            days: z.number().int().min(1).max(60).default(7),
            limit: z.number().int().min(1).max(20).default(10),
          }),
          async execute({ days, limit }) {
            const now = new Date();
            const until = new Date(now.getTime() + days * 86_400_000);
            const { data, error } = await serviceClient()
              .from("meetings")
              .select("id, title, scheduled_start, scheduled_end, location")
              .eq("property_id", propertyId)
              .gte("scheduled_start", now.toISOString())
              .lte("scheduled_start", until.toISOString())
              .order("scheduled_start", { ascending: true })
              .limit(limit);
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              meetings: (data ?? []).map((m) => ({
                id: m.id,
                title: m.title,
                start: m.scheduled_start,
                end: m.scheduled_end,
                location: m.location,
              })),
            };
          },
        });
      }

      if (grants.has("list_today_bookings")) {
        tools.list_today_bookings = defineTool({
          description:
            "List this property's bookings in the next 24 hours across all services (service, time, party size, status, reference). Use for questions about tonight's covers, arrivals, or capacity.",
          inputSchema: z.object({
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ limit }) {
            const now = new Date();
            const { data, error } = await serviceClient()
              .from("bookings")
              .select(
                "id, reference, guest_name, party_size, status, starts_at, service_id, bookable_services(name)",
              )
              .eq("property_id", propertyId)
              .gte("starts_at", now.toISOString())
              .lte("starts_at", new Date(now.getTime() + 86_400_000).toISOString())
              .not("status", "in", "(cancelled,no_show)")
              .order("starts_at", { ascending: true })
              .limit(limit);
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              bookings: (data ?? []).map((b) => ({
                reference: b.reference,
                guest: b.guest_name,
                party: b.party_size,
                status: b.status,
                starts_at: b.starts_at,
                service:
                  (b.bookable_services as { name?: string } | null)?.name ??
                  null,
              })),
            };
          },
        });
      }

      if (grants.has("get_org_chart")) {
        tools.get_org_chart = defineTool({
          description:
            "Get the property's org structure: teams, leads, and members with roles. Use when a request depends on who owns what or who to route work to.",
          inputSchema: z.object({}),
          async execute() {
            const supabase = serviceClient();
            const [{ data: teams }, { data: members }] = await Promise.all([
              supabase
                .from("spaces")
                .select("id, name, parent_space_id, lead_user_id")
                .eq("property_id", propertyId),
              supabase
                .from("memberships")
                .select("user_id, role, title, primary_space_id, manager_id")
                .eq("property_id", propertyId),
            ]);
            const userIds = (members ?? []).map((m) => m.user_id);
            const { data: profiles } = userIds.length
              ? await supabase
                  .from("profiles")
                  .select("id, full_name")
                  .in("id", userIds)
              : { data: [] };
            const nameById = new Map(
              (profiles ?? []).map((p) => [p.id, p.full_name]),
            );
            const teamNameById = new Map(
              (teams ?? []).map((t) => [t.id, t.name]),
            );
            return {
              teams: (teams ?? []).map((t) => ({
                name: t.name,
                parent: t.parent_space_id
                  ? (teamNameById.get(t.parent_space_id) ?? null)
                  : null,
                lead: t.lead_user_id
                  ? (nameById.get(t.lead_user_id) ?? null)
                  : null,
              })),
              people: (members ?? []).map((m) => ({
                name: nameById.get(m.user_id) ?? "Unknown",
                role: m.role,
                title: m.title,
                team: m.primary_space_id
                  ? (teamNameById.get(m.primary_space_id) ?? null)
                  : null,
                manager: m.manager_id
                  ? (nameById.get(m.manager_id) ?? null)
                  : null,
              })),
            };
          },
        });
      }

      if (grants.has("read_resource") && resourceIds.length > 0) {
        tools.read_resource = defineTool({
          description:
            "Read the full text of a document attached to this agent as a resource. Call list mode first (no id) to see what's attached, then read by id.",
          inputSchema: z.object({
            document_id: z
              .string()
              .optional()
              .describe("Omit to list attached resources; pass an id to read one."),
          }),
          async execute({ document_id }) {
            const supabase = serviceClient();
            if (!document_id) {
              const { data } = await supabase
                .from("documents")
                .select("id, title")
                .in("id", resourceIds)
                .eq("property_id", propertyId);
              return { resources: data ?? [] };
            }
            if (!resourceIds.includes(document_id)) {
              return { error: "That document is not attached to this agent." };
            }
            const { data, error } = await supabase
              .from("documents")
              .select("id, title, body_text")
              .eq("id", document_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (error || !data) return { error: "Document not found." };
            return {
              id: data.id,
              title: data.title,
              content: (data.body_text ?? "").slice(0, 30_000),
            };
          },
        });
      }

      return tools;
    },
  },
});
