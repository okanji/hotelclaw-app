import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { StreamChat } from "stream-chat";
import {
  brainToolDescriptions,
  brainToolSchemas,
  normalizeListPages,
  operatorReviewPage,
} from "@hotelclaw/brain";
import { serviceClient } from "../lib/supabase";
import { resolveSessionAgent } from "../lib/agent-config";
import { resolvePropertyBrainBinding } from "../lib/property-brain";
import { callBrainToolDirect } from "../lib/gbrain-http";
import { channelBotHeaders, eveSelfOrigin } from "../lib/channel-delivery";

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
      // The RAW message sender for role-gated tools. Channel-bot sessions
      // may act as a fallback property principal when the sender isn't a
      // member — role gates must check the SENDER's own membership, so a
      // non-member (or staff-level member) in a public channel can never
      // pull owner/manager surfaces through the bot.
      const senderAttr = ctx.session.auth.current?.attributes?.senderId;
      const senderId =
        typeof senderAttr === "string" && senderAttr ? senderAttr : userId;
      // Stream channel this session serves (channel-bot sessions only) —
      // background jobs deliver their results back into it.
      const channelAttr = ctx.session.auth.current?.attributes?.channelId;
      const sessionChannelId =
        typeof channelAttr === "string" && channelAttr ? channelAttr : null;
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
            "Create a task in this property's board. NEVER call this on a vague ask — first make sure you know the concrete deliverable, which team it belongs to, and any specifics the assignee will need (ask ONE short clarifying question if not); a task without context gets lost. Pass `team` when the user named one (fuzzy name match; on no match you get the valid team names back — re-ask, don't guess). Returns the task plus a `url` — always include it in your reply as a markdown link so people can open the task.",
          inputSchema: z.object({
            title: z.string().min(3).max(200),
            description: z
              .string()
              .max(2000)
              .optional()
              .describe(
                "Context the assignee needs: what/where/why, anything the requester said.",
              ),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
            team: z
              .string()
              .max(120)
              .optional()
              .describe("Team (space) name to file the task under."),
            due_at: z.iso
              .datetime({ offset: true })
              .optional()
              .describe("Due date-time, ISO 8601 with offset."),
          }),
          async execute({ title, description, priority, team, due_at }) {
            const supabase = serviceClient();
            let spaceId: string | null = null;
            if (team) {
              const { data: spaces } = await supabase
                .from("spaces")
                .select("id, name")
                .eq("property_id", propertyId);
              const needle = team.trim().toLowerCase();
              const match =
                (spaces ?? []).find((s) => s.name.toLowerCase() === needle) ??
                (spaces ?? []).find((s) =>
                  s.name.toLowerCase().includes(needle),
                );
              if (!match) {
                return {
                  error: `No team matches "${team}".`,
                  teams: (spaces ?? []).map((s) => s.name),
                };
              }
              spaceId = match.id;
            }
            const { data, error } = await supabase
              .from("tasks")
              .insert({
                property_id: propertyId,
                title,
                description: description ?? null,
                priority,
                status: "todo",
                source: "ai",
                created_by: userId,
                ...(spaceId ? { space_id: spaceId } : {}),
                ...(due_at ? { due_at } : {}),
              })
              .select("id, title, space_id")
              .single();
            if (error) return { error: error.message };
            return {
              created: true,
              task: data,
              url: `/p/${propertyId}/tasks/${data.id}`,
            };
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

      if (grants.has("update_task")) {
        tools.update_task = defineTool({
          description:
            "Update a task's status, priority, due date, assignee, title, or description. Get the task id from list_open_tasks/search_tasks first. Assignee is matched by person name (fuzzy; on no match you get valid names back — re-ask, don't guess). The Postgres triggers fire the same workflow automations the app UI does; assignment changes notify the assignee.",
          inputSchema: z.object({
            task_id: z.string().uuid(),
            status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
            priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
            due_at: z.iso.datetime({ offset: true }).nullish(),
            assignee_name: z
              .string()
              .max(120)
              .nullish()
              .describe("Person to assign (fuzzy name match); null to unassign."),
            title: z.string().min(3).max(200).optional(),
            description: z.string().max(4000).optional(),
          }),
          async execute({ task_id, status, priority, due_at, assignee_name, title, description }) {
            const supabase = serviceClient();
            const { data: task } = await supabase
              .from("tasks")
              .select("id, title, assignee_id")
              .eq("id", task_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!task) return { error: "Task not found in this property." };

            const patch: Record<string, unknown> = {};
            if (status) patch.status = status;
            if (priority) patch.priority = priority;
            if (due_at !== undefined) patch.due_at = due_at;
            if (title) patch.title = title;
            if (description !== undefined) patch.description = description;

            let assigneeId: string | null | undefined;
            if (assignee_name === null) assigneeId = null;
            else if (typeof assignee_name === "string") {
              const { data: members } = await supabase
                .from("memberships")
                .select("user_id")
                .eq("property_id", propertyId);
              const ids = (members ?? []).map((m) => m.user_id);
              const { data: profiles } = ids.length
                ? await supabase.from("profiles").select("id, full_name").in("id", ids)
                : { data: [] };
              const needle = assignee_name.trim().toLowerCase();
              const match =
                (profiles ?? []).find((p) => (p.full_name ?? "").toLowerCase() === needle) ??
                (profiles ?? []).find((p) =>
                  (p.full_name ?? "").toLowerCase().includes(needle),
                );
              if (!match) {
                return {
                  error: `No member matches "${assignee_name}".`,
                  members: (profiles ?? []).map((p) => p.full_name).filter(Boolean),
                };
              }
              assigneeId = match.id;
            }
            if (assigneeId !== undefined) patch.assignee_id = assigneeId;
            if (Object.keys(patch).length === 0) {
              return { error: "Nothing to update — pass at least one field." };
            }

            const { error } = await supabase
              .from("tasks")
              .update(patch)
              .eq("id", task_id)
              .eq("property_id", propertyId);
            if (error) return { error: error.message };

            // Mirror the app's assignment notification (workflow events are
            // covered by the tasks DB triggers; notifications are app-level).
            if (assigneeId && assigneeId !== task.assignee_id) {
              await supabase.from("notifications").insert({
                user_id: assigneeId,
                property_id: propertyId,
                type: "task_assigned",
                payload: { taskId: task_id, taskTitle: title ?? task.title },
              });
            }
            return {
              updated: true,
              task_id,
              changed: Object.keys(patch),
              link: `/p/${propertyId}/tasks/${task_id}`,
            };
          },
        });
      }

      if (grants.has("create_document")) {
        tools.create_document = defineTool({
          description:
            "Create a NEW document with real content (SOPs, runbooks, notes, plans). Write the body as clean HTML using only: h1-h3, p, ul/ol/li, blockquote, pre/code, table/thead/tbody/tr/th/td, strong/em/a. Returns the doc link — always include it in your reply. The content is immediately searchable and brain-mirrored.",
          inputSchema: z.object({
            title: z.string().min(1).max(200),
            content_html: z.string().min(20).max(100_000),
          }),
          async execute({ title, content_html }, toolCtx) {
            void toolCtx;
            const response = await fetch(
              `${eveSelfOrigin()}/api/internal/documents/write`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                body: JSON.stringify({
                  propertyId,
                  title,
                  html: content_html,
                  mode: "replace",
                  actorUserId: userId,
                }),
                signal: AbortSignal.timeout(45_000),
              },
            ).catch(() => null);
            if (!response?.ok) {
              const detail = response
                ? ((await response.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Document write failed (${response?.status ?? "unreachable"}).` };
            }
            const body = (await response.json()) as {
              documentId: string;
              bodyTextLength: number;
              url: string;
            };
            return {
              created: true,
              document_id: body.documentId,
              characters: body.bodyTextLength,
              link: body.url,
            };
          },
        });
      }

      if (grants.has("update_document")) {
        tools.update_document = defineTool({
          description:
            "Write CONTENT into an existing document — replace the whole body or append sections. Use for filling in stub docs, updating SOPs, adding sections. Get the id from list_documents/search_documents. Same HTML subset as create_document. This REPLACES/extends what's there — when unsure whether to overwrite meaningful existing content, confirm with the requester first. Content is immediately searchable and brain-mirrored; the doc updates live for anyone viewing it.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            content_html: z.string().min(10).max(100_000),
            mode: z
              .enum(["replace", "append"])
              .default("replace")
              .describe("replace = new body; append = add to the end"),
          }),
          async execute({ document_id, content_html, mode }) {
            const response = await fetch(
              `${eveSelfOrigin()}/api/internal/documents/write`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                body: JSON.stringify({
                  propertyId,
                  documentId: document_id,
                  html: content_html,
                  mode,
                }),
                signal: AbortSignal.timeout(45_000),
              },
            ).catch(() => null);
            if (!response?.ok) {
              const detail = response
                ? ((await response.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Document write failed (${response?.status ?? "unreachable"}).` };
            }
            const body = (await response.json()) as {
              documentId: string;
              bodyTextLength: number;
              url: string;
            };
            return {
              updated: true,
              document_id: body.documentId,
              characters: body.bodyTextLength,
              link: body.url,
            };
          },
        });
      }

      if (grants.has("archive_document")) {
        tools.archive_document = defineTool({
          description:
            "Archive a document AND all its sub-pages (reversible from the app's Archived list, but high-impact). The SYSTEM parks every call for human approval before it executes — call it directly when asked and let the approval gate do its job; never work around it.",
          approval: always(),
          inputSchema: z.object({
            document_id: z.string().uuid(),
            reason: z.string().min(5).max(300),
          }),
          async execute({ document_id, reason }) {
            const supabase = serviceClient();
            const { data: doc } = await supabase
              .from("documents")
              .select("id, title")
              .eq("id", document_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!doc) return { error: "Document not found in this property." };
            const { error } = await supabase.rpc("archive_document_tree", {
              root: document_id,
            });
            if (error) return { error: error.message };
            // Brain mirrors of the subtree are cleaned by the nightly
            // doc-sync sweep (archived_at > brain_synced_at staleness).
            return { archived: true, title: doc.title, reason };
          },
        });
      }

      if (grants.has("search_tasks")) {
        tools.search_tasks = defineTool({
          description:
            "Full-text search over ALL tasks — including done — by title and description. Use for 'have we ever had a task about X' and finding past work. Returns previews; if count is 0, no matching tasks exist.",
          inputSchema: z.object({
            query: z.string().min(1).max(200),
            include_done: z.boolean().default(true),
            limit: z.number().int().min(1).max(20).default(10),
          }),
          async execute({ query, include_done, limit }) {
            const { data, error } = await serviceClient().rpc(
              "search_tasks_keyword",
              {
                property_id_param: propertyId,
                query_text: query,
                include_done,
                match_count: limit,
              },
            );
            if (error) return { error: error.message };
            const rows = (data ?? []) as Array<{
              id: string;
              title: string;
              status: string;
              priority: string | null;
              due_at: string | null;
              preview: string;
              updated_at: string;
            }>;
            return {
              count: rows.length,
              tasks: rows.map((t) => ({
                id: t.id,
                title: t.title,
                status: STATUS_LABELS[t.status] ?? t.status,
                priority: t.priority,
                due: t.due_at,
                preview: t.preview,
                updated: t.updated_at,
              })),
            };
          },
        });
      }

      if (grants.has("list_documents")) {
        tools.list_documents = defineTool({
          description:
            "List the property's documents (title, kind, last edited), most recently edited first. Use for enumeration questions — 'what SOPs/docs do we have' — optionally narrowed by a title fragment; use search_documents for content matches.",
          inputSchema: z.object({
            title_contains: z
              .string()
              .max(100)
              .optional()
              .describe("Case-insensitive title filter, e.g. 'SOP'"),
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ title_contains, limit }) {
            let query = serviceClient()
              .from("documents")
              .select("id, title, kind, updated_at")
              .eq("property_id", propertyId)
              .is("archived_at", null)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (title_contains) {
              query = query.ilike("title", `%${title_contains}%`);
            }
            const { data, error } = await query;
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              documents: (data ?? []).map((d) => ({
                id: d.id,
                title: d.title,
                kind: d.kind,
                updated: d.updated_at,
              })),
            };
          },
        });
      }

      if (grants.has("list_meetings")) {
        tools.list_meetings = defineTool({
          description:
            "List meetings in a window — PAST meetings included (title, start, end, location). Use for 'what came out of last week's meetings' (then search_documents for the meeting-summary doc) and upcoming schedules. Times ISO 8601.",
          inputSchema: z.object({
            past_days: z.number().int().min(0).max(365).default(0),
            next_days: z.number().int().min(0).max(60).default(7),
            limit: z.number().int().min(1).max(30).default(15),
          }),
          async execute({ past_days, next_days, limit }) {
            const now = Date.now();
            const from = new Date(now - past_days * 86_400_000);
            const to = new Date(now + next_days * 86_400_000);
            const { data, error } = await serviceClient()
              .from("meetings")
              .select("id, title, scheduled_start, scheduled_end, location")
              .eq("property_id", propertyId)
              .gte("scheduled_start", from.toISOString())
              .lte("scheduled_start", to.toISOString())
              .order("scheduled_start", { ascending: past_days === 0 })
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

      if (grants.has("list_bookings")) {
        tools.list_bookings = defineTool({
          description:
            "List bookings across all services for a window — past history included (service, time, party, status, reference). Defaults to the next 24h; raise past_days for history questions ('how many no-shows last week').",
          inputSchema: z.object({
            past_days: z.number().int().min(0).max(60).default(0),
            next_days: z.number().int().min(0).max(60).default(1),
            status: z
              .enum([
                "pending",
                "confirmed",
                "seated",
                "completed",
                "cancelled",
                "no_show",
              ])
              .optional(),
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ past_days, next_days, status, limit }) {
            const now = Date.now();
            let query = serviceClient()
              .from("bookings")
              .select(
                "id, reference, guest_name, party_size, status, starts_at, bookable_services(name)",
              )
              .eq("property_id", propertyId)
              .gte("starts_at", new Date(now - past_days * 86_400_000).toISOString())
              .lte("starts_at", new Date(now + next_days * 86_400_000).toISOString())
              .order("starts_at", { ascending: true })
              .limit(limit);
            if (status) query = query.eq("status", status);
            const { data, error } = await query;
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
                  (b.bookable_services as { name?: string } | null)?.name ?? null,
              })),
            };
          },
        });
      }

      if (grants.has("search_chat_messages")) {
        tools.search_chat_messages = defineTool({
          description:
            "Search past chat messages in this property's channels — scoped to channels the REQUESTING PERSON is a member of. Use for 'what did we say about X' / 'who mentioned Y'. Returns message text, sender, channel, and time.",
          inputSchema: z.object({
            query: z.string().min(2).max(200),
            limit: z.number().int().min(1).max(20).default(10),
          }),
          async execute({ query, limit }) {
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const secret = process.env.STREAM_API_SECRET;
            if (!apiKey || !secret) return { error: "Chat search not configured." };
            try {
              const server = StreamChat.getInstance(apiKey, secret, {
                timeout: 15_000,
              });
              // Tenancy: property_id custom field + the SENDER's channel
              // membership. A non-member sender matches no channels — empty,
              // never leaking the acting principal's channels.
              const res = await server.search(
                {
                  type: { $in: ["team", "messaging"] },
                  property_id: propertyId,
                  members: { $in: [senderId] },
                } as Parameters<typeof server.search>[0],
                query,
                { limit, sort: [{ created_at: -1 }] },
              );
              return {
                count: res.results.length,
                messages: res.results.map((r) => ({
                  text: (r.message.text ?? "").slice(0, 500),
                  sender: r.message.user?.name ?? r.message.user?.id ?? "unknown",
                  channel: r.message.channel?.id ?? null,
                  at: r.message.created_at,
                })),
              };
            } catch (e) {
              return {
                error: e instanceof Error ? e.message : "chat search failed",
              };
            }
          },
        });
      }

      if (grants.has("list_forms")) {
        tools.list_forms = defineTool({
          description:
            "List the property's forms (title, status, response count). Use to answer 'what forms do we have' and to find a form id for get_form_response_summaries.",
          inputSchema: z.object({
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ limit }) {
            const supabase = serviceClient();
            const { data: forms, error } = await supabase
              .from("forms")
              .select("id, title, description, status, updated_at")
              .eq("property_id", propertyId)
              .is("archived_at", null)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (error) return { error: error.message };
            const ids = (forms ?? []).map((f) => f.id);
            const countByForm = new Map<string, number>();
            if (ids.length > 0) {
              const { data: responses } = await supabase
                .from("form_responses")
                .select("form_id")
                .in("form_id", ids);
              for (const r of responses ?? []) {
                countByForm.set(r.form_id, (countByForm.get(r.form_id) ?? 0) + 1);
              }
            }
            return {
              count: (forms ?? []).length,
              forms: (forms ?? []).map((f) => ({
                id: f.id,
                title: f.title,
                description: f.description,
                status: f.status,
                responses: countByForm.get(f.id) ?? 0,
              })),
            };
          },
        });
      }

      if (grants.has("get_form_response_summaries")) {
        tools.get_form_response_summaries = defineTool({
          description:
            "Aggregated response summary for one form: per-field value counts for choice/number/boolean fields and recent samples for text fields. Get the form id from list_forms first.",
          inputSchema: z.object({
            form_id: z.string().uuid(),
            limit: z.number().int().min(1).max(500).default(200),
          }),
          async execute({ form_id, limit }) {
            const supabase = serviceClient();
            const { data: form } = await supabase
              .from("forms")
              .select("id, title, schema")
              .eq("id", form_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!form) return { error: "Form not found in this property." };
            const { data: responses, error } = await supabase
              .from("form_responses")
              .select("answers, created_at")
              .eq("form_id", form_id)
              .order("created_at", { ascending: false })
              .limit(limit);
            if (error) return { error: error.message };

            const schema = (form.schema ?? {}) as {
              fields?: Array<{ id?: string; label?: string; type?: string }>;
            };
            const fields = (schema.fields ?? []).filter(
              (f): f is { id: string; label?: string; type?: string } =>
                typeof f?.id === "string",
            );
            const summaries = fields.map((field) => {
              const values = (responses ?? [])
                .map((r) => (r.answers as Record<string, unknown>)?.[field.id])
                .filter((v) => v !== undefined && v !== null && v !== "");
              const scalars = values.filter(
                (v) =>
                  typeof v === "boolean" ||
                  typeof v === "number" ||
                  (typeof v === "string" && v.length <= 80),
              );
              const counts = new Map<string, number>();
              for (const v of scalars) {
                const key = String(v);
                counts.set(key, (counts.get(key) ?? 0) + 1);
              }
              const topValues = [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([value, n]) => ({ value, count: n }));
              const textSamples = values
                .filter((v): v is string => typeof v === "string" && v.length > 80)
                .slice(0, 3)
                .map((v) => v.slice(0, 300));
              return {
                field: field.label ?? field.id,
                type: field.type ?? "unknown",
                answered: values.length,
                top_values: topValues,
                ...(textSamples.length > 0 ? { recent_text: textSamples } : {}),
              };
            });
            return {
              form: { id: form.id, title: form.title },
              response_count: (responses ?? []).length,
              fields: summaries,
            };
          },
        });
      }

      if (grants.has("guest_conversation_insights")) {
        tools.guest_conversation_insights = defineTool({
          description:
            "What guests have been asking the property's chatbots: totals by outcome, topic + sentiment breakdown, and recent escalated/negative conversations. Use for 'what are guests complaining about', 'how busy was the chatbot'.",
          inputSchema: z.object({
            days: z.number().int().min(1).max(90).default(7),
            limit: z.number().int().min(1).max(200).default(100),
          }),
          async execute({ days, limit }) {
            const since = new Date(Date.now() - days * 86_400_000).toISOString();
            const { data, error } = await serviceClient()
              .from("chatbot_conversations")
              .select(
                "id, chatbot_id, channel, status, outcome, topic, sentiment, guest_name, message_count, created_at, chatbots(name)",
              )
              .eq("property_id", propertyId)
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(limit);
            if (error) return { error: error.message };
            const rows = data ?? [];
            const byOutcome: Record<string, number> = {};
            const topics = new Map<
              string,
              { count: number; negative: number; positive: number }
            >();
            for (const c of rows) {
              byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
              if (c.topic) {
                const t = topics.get(c.topic) ?? {
                  count: 0,
                  negative: 0,
                  positive: 0,
                };
                t.count += 1;
                if (c.sentiment === "negative") t.negative += 1;
                if (c.sentiment === "positive") t.positive += 1;
                topics.set(c.topic, t);
              }
            }
            return {
              window_days: days,
              conversation_count: rows.length,
              by_outcome: byOutcome,
              topics: [...topics.entries()]
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 12)
                .map(([topic, t]) => ({ topic, ...t })),
              recent_escalations: rows
                .filter((c) => c.outcome === "escalated" || c.sentiment === "negative")
                .slice(0, 8)
                .map((c) => ({
                  bot: (c.chatbots as { name?: string } | null)?.name ?? null,
                  channel: c.channel,
                  topic: c.topic,
                  sentiment: c.sentiment,
                  outcome: c.outcome,
                  guest: c.guest_name,
                  at: c.created_at,
                })),
            };
          },
        });
      }

      // Role-gated management surfaces. These check the SENDER's own
      // membership at call time — the acting-principal fallback never
      // satisfies them (see senderId above). The check is INLINED in each
      // execute rather than a shared helper: the eve build transform
      // serializes closure captures, and a captured FUNCTION does not
      // survive workflow replay on Vercel.
      {
        const ROLE_DENIED =
          "This is a management surface — only property owners and managers can ask for it. Tell the requester that, plainly.";

        if (grants.has("get_insight_brief")) {
          tools.get_insight_brief = defineTool({
            description:
              "The property's cached intelligence brief (Insights cards: pace flags, anomalies, watch items). Owner/manager only — refuse politely for anyone else. Never generates; reads the cache.",
            inputSchema: z.object({}),
            async execute() {
              const { data: sender } = await serviceClient()
                .from("memberships")
                .select("role")
                .eq("property_id", propertyId)
                .eq("user_id", senderId)
                .maybeSingle();
              if (!sender || !["owner", "manager"].includes(sender.role)) {
                return { denied: ROLE_DENIED };
              }
              const { data, error } = await serviceClient()
                .from("insight_briefs")
                .select("insights, generated_at")
                .eq("property_id", propertyId)
                .maybeSingle();
              if (error) return { error: error.message };
              if (!data) return { count: 0, note: "No brief has been generated yet." };
              return {
                generated_at: data.generated_at,
                insights: JSON.parse(
                  JSON.stringify(data.insights).slice(0, 12_000),
                ),
              };
            },
          });
        }

        if (grants.has("get_weekly_report")) {
          tools.get_weekly_report = defineTool({
            description:
              "The latest cached weekly report (management or staff audience). Owner/manager only — refuse politely for anyone else. Never generates; reads the cache.",
            inputSchema: z.object({
              audience: z.enum(["management", "staff"]).default("management"),
            }),
            async execute({ audience }) {
              const { data: sender } = await serviceClient()
                .from("memberships")
                .select("role")
                .eq("property_id", propertyId)
                .eq("user_id", senderId)
                .maybeSingle();
              if (!sender || !["owner", "manager"].includes(sender.role)) {
                return { denied: ROLE_DENIED };
              }
              const { data, error } = await serviceClient()
                .from("insight_reports")
                .select("period_start, period_end, audience, summary_md, created_at")
                .eq("property_id", propertyId)
                .eq("audience", audience)
                .order("period_start", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (error) return { error: error.message };
              if (!data) return { note: "No weekly report has been generated yet." };
              return {
                period: { start: data.period_start, end: data.period_end },
                audience: data.audience,
                report_md: data.summary_md.slice(0, 8_000),
              };
            },
          });
        }

        if (grants.has("list_handovers")) {
          tools.list_handovers = defineTool({
            description:
              "Recent published shift handovers (author, window, content). Owner/manager only — refuse politely for anyone else.",
            inputSchema: z.object({
              limit: z.number().int().min(1).max(10).default(5),
            }),
            async execute({ limit }) {
              const { data: sender } = await serviceClient()
                .from("memberships")
                .select("role")
                .eq("property_id", propertyId)
                .eq("user_id", senderId)
                .maybeSingle();
              if (!sender || !["owner", "manager"].includes(sender.role)) {
                return {
                  denied:
                    "This is a management surface — only property owners and managers can ask for it. Tell the requester that, plainly.",
                };
              }
              const supabase = serviceClient();
              const { data, error } = await supabase
                .from("handovers")
                .select("id, author_id, body_md, window_start, window_end, created_at")
                .eq("property_id", propertyId)
                .order("created_at", { ascending: false })
                .limit(limit);
              if (error) return { error: error.message };
              const authorIds = [
                ...new Set((data ?? []).map((h) => h.author_id)),
              ];
              const { data: profiles } = authorIds.length
                ? await supabase
                    .from("profiles")
                    .select("id, full_name")
                    .in("id", authorIds)
                : { data: [] };
              const nameById = new Map(
                (profiles ?? []).map((p) => [p.id, p.full_name]),
              );
              return {
                count: (data ?? []).length,
                handovers: (data ?? []).map((h) => ({
                  author: nameById.get(h.author_id) ?? "Unknown",
                  window: { start: h.window_start, end: h.window_end },
                  published: h.created_at,
                  body_md: h.body_md.slice(0, 2_000),
                })),
              };
            },
          });
        }
      }

      // Detached background jobs ("Separate sessions still run
      // independently" — eve execution-model docs). The conversational
      // session stays free for everyone else while N jobs run in parallel;
      // each job's result is posted to the channel by the same delivery
      // handlers when its session parks (kind='job' row, migration 0093).
      if (grants.has("start_background_job") && sessionChannelId) {
        tools.start_background_job = defineTool({
          description:
            "Start a DETACHED background job for heavy, long-running work (audits, reports, bulk analysis, anything needing many steps or minutes of work) and reply to the requester immediately. The job runs in its own session with the same capabilities and posts its results to this channel when done, prefixed with your headline. After calling this, tell the requester the job is running and results will be posted here. Do NOT use it for quick lookups you can answer in this turn.",
          inputSchema: z.object({
            headline: z
              .string()
              .min(5)
              .max(120)
              .describe("Short label shown when results post, e.g. 'Weekly SOP coverage audit'"),
            brief: z
              .string()
              .min(20)
              .max(4000)
              .describe(
                "Self-contained task brief: goal, scope, what the final answer must contain. The job cannot ask follow-up questions.",
              ),
          }),
          async execute({ headline, brief }, toolCtx) {
            const supabase = serviceClient();
            // Recursion guard: jobs may not spawn jobs.
            const selfSessionId = toolCtx?.session?.id;
            if (selfSessionId) {
              const { data: selfRow } = await supabase
                .from("channel_bot_sessions")
                .select("kind")
                .eq("eve_session_id", selfSessionId)
                .maybeSingle();
              if (selfRow?.kind === "job") {
                return {
                  error:
                    "Already running as a background job — do the work here instead of starting another job.",
                };
              }
            }

            const jobHeaders = await channelBotHeaders({
              propertyId,
              channelId: sessionChannelId,
              senderId,
            });
            if (!jobHeaders) return { error: "Could not authorize the job session." };

            const jobNonce = crypto.randomUUID();
            const jobMessage = [
              `[turn ${jobNonce} — internal marker, ignore]`,
              `[Background job — you are running DETACHED. Work autonomously to completion; nobody can answer follow-up questions. Never call start_background_job. Deliver ONE final answer — it will be posted to the team channel under the headline "${headline}". Keep it tight and scannable (aim under 4000 characters): lead with findings, use short sections, cut process narration.]`,
              brief,
            ].join("\n\n");

            const created = await fetch(`${eveSelfOrigin()}/eve/v1/session`, {
              method: "POST",
              headers: jobHeaders,
              body: JSON.stringify({ message: jobMessage }),
              signal: AbortSignal.timeout(15_000),
            }).catch(() => null);
            if (!created?.ok) {
              return { error: `Job session create failed (${created?.status ?? "unreachable"}).` };
            }
            const createdBody = (await created.json()) as { sessionId?: string };
            if (!createdBody.sessionId) return { error: "Job session returned no id." };

            const { data: chatRow } = await supabase
              .from("channel_bot_sessions")
              .select("channel_type")
              .eq("channel_id", sessionChannelId)
              .eq("thread_key", "_root")
              .maybeSingle();

            const { error: rowError } = await supabase
              .from("channel_bot_sessions")
              .insert({
                property_id: propertyId,
                channel_id: sessionChannelId,
                channel_type: chatRow?.channel_type ?? "team",
                thread_key: `job:${crypto.randomUUID()}`,
                kind: "job",
                job_headline: headline,
                eve_session_id: createdBody.sessionId,
                turn_nonce: jobNonce,
                turn_state: "running",
                turn_started_at: new Date().toISOString(),
                last_turn_at: new Date().toISOString(),
              });
            if (rowError) {
              return { error: `Job started but tracking failed: ${rowError.message}` };
            }
            return {
              started: true,
              headline,
              note: "Job is running detached. Tell the requester results will be posted to this channel when it finishes.",
            };
          },
        });
      }

      // Brain grants (mirror tools/channel-brain.ts — keep descriptions in
      // sync). Fail-soft: granted but no property binding ⇒ the tools simply
      // don't exist, same as every other ungranted capability.
      const wantsBrain =
        grants.has("brain_search") ||
        grants.has("brain_think") ||
        grants.has("brain_get") ||
        grants.has("brain_list") ||
        grants.has("brain_capture");
      const binding = wantsBrain
        ? await resolvePropertyBrainBinding(propertyId)
        : null;
      if (binding) {
        const brainMcpUrl = binding.url;
        const brainCred = {
          clientId: binding.clientId,
          clientSecret: binding.clientSecret,
        };

        if (grants.has("brain_search")) {
          tools.brain_search = defineTool({
            description: brainToolDescriptions.brain_search,
            inputSchema: brainToolSchemas.brain_search,
            async execute({ query, limit }) {
              const result = await callBrainToolDirect(brainMcpUrl, brainCred, "search", {
                query,
                limit,
              });
              return result.ok
                ? { results: result.content }
                : { unavailable: true, reason: result.reason };
            },
          });
        }

        if (grants.has("brain_think")) {
          tools.brain_think = defineTool({
            description: brainToolDescriptions.brain_think,
            inputSchema: brainToolSchemas.brain_think,
            async execute({ question }) {
              const result = await callBrainToolDirect(
                brainMcpUrl,
                brainCred,
                "think",
                { question },
                { timeoutMs: 60_000 },
              );
              return result.ok
                ? { answer: result.content }
                : { unavailable: true, reason: result.reason };
            },
          });
        }

        if (grants.has("brain_get")) {
          tools.brain_get = defineTool({
            description: brainToolDescriptions.brain_get,
            inputSchema: brainToolSchemas.brain_get,
            async execute({ slug }) {
              const result = await callBrainToolDirect(brainMcpUrl, brainCred, "get_page", {
                slug,
              });
              if (!result.ok) {
                return { unavailable: true, reason: result.reason };
              }
              const page =
                typeof result.content === "string"
                  ? result.content
                  : ((result.content as { content?: string; markdown?: string } | null)
                      ?.content ??
                    (result.content as { markdown?: string } | null)?.markdown ??
                    "");
              if (!page) return { found: false, slug };
              return { found: true, slug, markdown: page.slice(0, 20_000) };
            },
          });
        }

        if (grants.has("brain_list")) {
          tools.brain_list = defineTool({
            description: brainToolDescriptions.brain_list,
            inputSchema: brainToolSchemas.brain_list,
            async execute({ prefix, limit }) {
              const result = await callBrainToolDirect(brainMcpUrl, brainCred, "list_pages", {
                ...(prefix ? { prefix } : {}),
                limit,
                sort: "updated_desc",
              });
              if (!result.ok) {
                return { unavailable: true, reason: result.reason };
              }
              const listed = normalizeListPages(result.content);
              // Some serves ignore unknown filter params — apply the prefix
              // client-side too so the contract holds regardless.
              const pages = prefix
                ? listed.pages.filter((p) => p.slug.startsWith(prefix))
                : listed.pages;
              return { count: pages.length, pages: pages.slice(0, limit) };
            },
          });
        }

        if (grants.has("brain_capture")) {
          tools.brain_capture = defineTool({
            description: brainToolDescriptions.brain_capture,
            inputSchema: brainToolSchemas.brain_capture,
            async execute({ slug, page_title, observation, source }) {
              const existing = await callBrainToolDirect(brainMcpUrl, brainCred, "get_page", {
                slug,
              });
              if (!existing.ok) {
                const created = await callBrainToolDirect(brainMcpUrl, brainCred, "put_page", {
                  slug,
                  content: operatorReviewPage(page_title),
                  ingested_via: "hotelclaw-custom-agent",
                });
                if (!created.ok) return { captured: false, reason: created.reason };
              }
              const entry = await callBrainToolDirect(brainMcpUrl, brainCred, "add_timeline_entry", {
                slug,
                date: new Date().toISOString().slice(0, 10),
                summary: observation,
                source,
              });
              return entry.ok
                ? { captured: true, slug }
                : { captured: false, reason: entry.reason };
            },
          });
        }
      }

      return tools;
    },
  },
});
