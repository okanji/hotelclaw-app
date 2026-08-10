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
      // Identifies THIS session's channel_bot_sessions row, so in-turn Stream
      // posts (artifact cards, form cards) can read the live `turn_nonce` and
      // stamp it as `eve_turn`. The chat client groups every message sharing
      // an `eve_turn` into ONE reply cluster (avatar + name + timestamp once),
      // however long the turn ran — see `slackGroupStyles` in
      // apps/web/components/chat/slack-message-ui.tsx.
      const eveSessionId = ctx.session.id;
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
            "Update a task's status, priority, due date, assignee, title, description, labels, or project. Get the task id from list_open_tasks/search_tasks first. Assignee is matched by person name (fuzzy; on no match you get valid names back — re-ask, don't guess). project_name moves the task into a project by name (empty string removes it). The Postgres triggers fire the same workflow automations the app UI does; assignment changes notify the assignee.",
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
            labels_add: z.array(z.string().min(1).max(40)).max(10).optional(),
            labels_remove: z.array(z.string().min(1).max(40)).max(10).optional(),
            project_name: z
              .string()
              .max(200)
              .optional()
              .describe("Project to move the task into (fuzzy name match); empty string to remove from its project."),
          }),
          async execute({ task_id, status, priority, due_at, assignee_name, title, description, labels_add, labels_remove, project_name }) {
            const supabase = serviceClient();
            const { data: task } = await supabase
              .from("tasks")
              .select("id, title, assignee_id, labels")
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

            if (labels_add?.length || labels_remove?.length) {
              const current: string[] = Array.isArray(task.labels) ? task.labels : [];
              const removeSet = new Set(
                (labels_remove ?? []).map((l) => l.trim().toLowerCase()),
              );
              const next = current.filter((l) => !removeSet.has(l.toLowerCase()));
              for (const l of labels_add ?? []) {
                const clean = l.trim();
                if (clean && !next.some((x) => x.toLowerCase() === clean.toLowerCase())) {
                  next.push(clean);
                }
              }
              patch.labels = next;
            }

            if (project_name === "") {
              patch.project_id = null;
            } else if (typeof project_name === "string") {
              const { data: projects } = await supabase
                .from("projects")
                .select("id, name")
                .eq("property_id", propertyId)
                .is("archived_at", null);
              const projNeedle = project_name.trim().toLowerCase();
              const proj =
                (projects ?? []).find((p) => p.name.toLowerCase() === projNeedle) ??
                (projects ?? []).find((p) => p.name.toLowerCase().includes(projNeedle));
              if (!proj) {
                return {
                  error: `No project matches "${project_name}".`,
                  projects: (projects ?? []).map((p) => p.name),
                };
              }
              patch.project_id = proj.id;
            }

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
            // The payload shape matches emitTaskAssignmentNotifications —
            // the feed renders byUserName, falling back to "Someone".
            if (assigneeId && assigneeId !== task.assignee_id) {
              const { data: senderProfile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", senderId)
                .maybeSingle();
              await supabase.from("notifications").insert({
                user_id: assigneeId,
                property_id: propertyId,
                type: "task_assigned",
                payload: {
                  taskId: task_id,
                  taskTitle: title ?? task.title,
                  byUserId: senderId,
                  byUserName: senderProfile?.full_name ?? "Hotelclaw AI",
                },
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

      if (grants.has("read_document")) {
        tools.read_document = defineTool({
          description:
            "Read a document's FULL body as clean HTML (faithful structure: headings, lists, tables). Use before answering detailed questions about a doc's contents, and ALWAYS before update_document on an existing doc — edit the returned HTML surgically and send the whole revised body back, preserving everything you didn't change. Get the id from list_documents/search_documents.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
          }),
          async execute({ document_id }) {
            const response = await fetch(
              `${eveSelfOrigin()}/api/internal/documents/read?propertyId=${encodeURIComponent(propertyId)}&documentId=${encodeURIComponent(document_id)}`,
              {
                headers: {
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                signal: AbortSignal.timeout(20_000),
              },
            ).catch(() => null);
            if (!response?.ok) {
              const detail = response
                ? ((await response.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Document read failed (${response?.status ?? "unreachable"}).` };
            }
            const body = (await response.json()) as {
              title: string;
              html: string;
              characters: number;
            };
            return {
              title: body.title,
              html: body.html.slice(0, 60_000),
              characters: body.characters,
              link: `/p/${propertyId}/documents/${document_id}`,
            };
          },
        });
      }

      if (grants.has("create_document")) {
        tools.create_document = defineTool({
          description:
            "Create a NEW document with real content (SOPs, runbooks, notes, plans). Write the body as clean HTML using only: h1-h3, p, ul/ol/li, blockquote, pre/code, table/thead/tbody/tr/th/td, strong/em/a. An artifact card appears in the channel so people can watch the doc being written live. Returns the doc link — include it in your reply.",
          inputSchema: z.object({
            title: z.string().min(1).max(200),
            content_html: z.string().min(20).max(100_000),
          }),
          async execute({ title, content_html }, toolCtx) {
            // Reserve the document row BEFORE the card + body write, so the
            // card carries a real document_id: the chat panel auto-opens on
            // the live Liveblocks room and the viewer watches the body being
            // written. (Creating and writing in one call meant the id only
            // existed once there was nothing left to watch.)
            const reserved = await fetch(
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
                  actorUserId: userId,
                  reserveOnly: true,
                }),
                signal: AbortSignal.timeout(20_000),
              },
            ).catch(() => null);
            if (!reserved?.ok) {
              const detail = reserved
                ? ((await reserved.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Document create failed (${reserved?.status ?? "unreachable"}).` };
            }
            const reservedBody = (await reserved.json()) as {
              documentId: string;
              url: string;
            };

            // Live artifact card (deterministic id per tool call — Stream
            // upserts on id, so step replays can't duplicate it).
            const cardId = `eve-artifact-${toolCtx.callId}`;
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const streamSecret = process.env.STREAM_API_SECRET;
            let cardChannel: ReturnType<StreamChat["channel"]> | null = null;
            if (apiKey && streamSecret && sessionChannelId) {
              const { data: chatRow } = await serviceClient()
                .from("channel_bot_sessions")
                .select("channel_type, turn_nonce")
                .eq("eve_session_id", eveSessionId)
                .maybeSingle();
              const server = StreamChat.getInstance(apiKey, streamSecret, {
                timeout: 15_000,
              });
              cardChannel = server.channel(
                chatRow?.channel_type ?? "team",
                sessionChannelId,
              );
              await cardChannel
                .sendMessage({
                  id: cardId,
                  text: "",
                  user_id: process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                  ai_generated: true,
                  // Groups this card with the rest of the turn (see eveSessionId).
                  eve_turn: chatRow?.turn_nonce ?? undefined,
                  attachments: [
                    {
                      type: "app_artifact",
                      kind: "document",
                      status: "writing",
                      action: "created",
                      title,
                      document_id: reservedBody.documentId,
                      href: reservedBody.url,
                      property_id: propertyId,
                    },
                  ],
                } as unknown as Parameters<NonNullable<typeof cardChannel>["sendMessage"]>[0])
                .catch(() => {});
            }

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
                  documentId: reservedBody.documentId,
                  html: content_html,
                  mode: "replace",
                }),
                signal: AbortSignal.timeout(55_000),
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
              title: string | null;
              bodyTextLength: number;
              url: string;
            };
            if (cardChannel) {
              // sendMessage with an existing id DEDUPES (returns the
              // original) — flipping the card needs a partial UPDATE.
              const server2 = StreamChat.getInstance(
                process.env.NEXT_PUBLIC_STREAM_API_KEY ?? "",
                process.env.STREAM_API_SECRET ?? "",
                { timeout: 15_000 },
              );
              await server2
                .partialUpdateMessage(
                  cardId,
                  {
                    set: {
                      attachments: [
                        {
                          type: "app_artifact",
                          kind: "document",
                          status: "done",
                          action: "created",
                          title: body.title ?? title,
                          document_id: body.documentId,
                          href: body.url,
                          property_id: propertyId,
                        },
                      ],
                    },
                  } as unknown as Parameters<typeof server2.partialUpdateMessage>[1],
                  process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                )
                .catch(() => {});
            }
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
            "Write CONTENT into an existing document — replace the whole body or append sections, and optionally rename it. Use for filling in stub docs, updating SOPs, adding sections. Get the id from list_documents/search_documents. Same HTML subset as create_document. Pass new_title to also set the record's title in the same call (e.g. an 'Untitled' doc you're filling with a titled SOP — set new_title to the SOP's name). This REPLACES/extends the body — when unsure whether to overwrite meaningful existing content, confirm with the requester first. An artifact card appears in the channel so people can watch the edit happen live; content is immediately searchable and brain-mirrored.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            content_html: z.string().min(10).max(100_000),
            new_title: z
              .string()
              .min(1)
              .max(200)
              .optional()
              .describe("Also rename the record to this title."),
            mode: z
              .enum(["replace", "append"])
              .default("replace")
              .describe("replace = new body; append = add to the end"),
          }),
          async execute({ document_id, content_html, new_title, mode }, toolCtx) {
            const supabase = serviceClient();
            const { data: docRow } = await supabase
              .from("documents")
              .select("title")
              .eq("id", document_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!docRow) return { error: "Document not found in this property." };
            const cardTitle = new_title ?? docRow.title;

            const cardId = `eve-artifact-${toolCtx.callId}`;
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const streamSecret = process.env.STREAM_API_SECRET;
            let cardChannel: ReturnType<StreamChat["channel"]> | null = null;
            if (apiKey && streamSecret && sessionChannelId) {
              const { data: chatRow } = await supabase
                .from("channel_bot_sessions")
                .select("channel_type, turn_nonce")
                .eq("eve_session_id", eveSessionId)
                .maybeSingle();
              const server = StreamChat.getInstance(apiKey, streamSecret, {
                timeout: 15_000,
              });
              cardChannel = server.channel(
                chatRow?.channel_type ?? "team",
                sessionChannelId,
              );
              await cardChannel
                .sendMessage({
                  id: cardId,
                  text: "",
                  user_id: process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                  ai_generated: true,
                  // Groups this card with the rest of the turn (see eveSessionId).
                  eve_turn: chatRow?.turn_nonce ?? undefined,
                  attachments: [
                    {
                      type: "app_artifact",
                      kind: "document",
                      status: "writing",
                      action: mode === "append" ? "appending" : "rewriting",
                      title: cardTitle,
                      document_id,
                      href: `/p/${propertyId}/documents/${document_id}`,
                      property_id: propertyId,
                    },
                  ],
                } as unknown as Parameters<NonNullable<typeof cardChannel>["sendMessage"]>[0])
                .catch(() => {});
            }

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
                  ...(new_title ? { title: new_title } : {}),
                  ...(userId ? { actorUserId: userId } : {}),
                }),
                signal: AbortSignal.timeout(55_000),
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
              title: string | null;
              bodyTextLength: number;
              url: string;
            };
            if (cardChannel) {
              // sendMessage with an existing id DEDUPES (returns the
              // original) — flipping the card needs a partial UPDATE.
              const server2 = StreamChat.getInstance(
                process.env.NEXT_PUBLIC_STREAM_API_KEY ?? "",
                process.env.STREAM_API_SECRET ?? "",
                { timeout: 15_000 },
              );
              await server2
                .partialUpdateMessage(
                  cardId,
                  {
                    set: {
                      attachments: [
                        {
                          type: "app_artifact",
                          kind: "document",
                          status: "done",
                          action: "updated",
                          title: body.title ?? docRow.title,
                          document_id: body.documentId,
                          href: body.url,
                          property_id: propertyId,
                        },
                      ],
                    },
                  } as unknown as Parameters<typeof server2.partialUpdateMessage>[1],
                  process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                )
                .catch(() => {});
            }
            return {
              updated: true,
              document_id: body.documentId,
              characters: body.bodyTextLength,
              title: body.title,
              link: body.url,
            };
          },
        });
      }

      if (grants.has("rename_document")) {
        tools.rename_document = defineTool({
          description:
            "Rename a document — set the record's title (the name shown in lists, artifact cards, and search). This does NOT touch the body: use it when a doc's content is fine but its title is wrong or 'Untitled'. A doc whose body already has a real <h1> just needs its title set to that heading. Get the id from list_documents/search_documents. For renaming AND rewriting in one go, pass new_title to update_document instead.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            new_title: z.string().min(1).max(200),
          }),
          async execute({ document_id, new_title }) {
            const supabase = serviceClient();
            const { data: docRow } = await supabase
              .from("documents")
              .select("title")
              .eq("id", document_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!docRow) return { error: "Document not found in this property." };

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
                  title: new_title,
                  ...(userId ? { actorUserId: userId } : {}),
                }),
                signal: AbortSignal.timeout(20_000),
              },
            ).catch(() => null);
            if (!response?.ok) {
              const detail = response
                ? ((await response.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Rename failed (${response?.status ?? "unreachable"}).` };
            }
            const body = (await response.json()) as {
              documentId: string;
              title: string | null;
              url: string;
            };
            return {
              renamed: true,
              document_id: body.documentId,
              from: docRow.title,
              to: body.title,
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

      if (grants.has("delete_task")) {
        tools.delete_task = defineTool({
          description:
            "Permanently DELETE a task (irreversible — unlike marking it done). The SYSTEM parks every call for human approval before it executes — call it directly when asked and let the approval gate do its job; never work around it.",
          approval: always(),
          inputSchema: z.object({
            task_id: z.string().uuid(),
            reason: z.string().min(5).max(300),
          }),
          async execute({ task_id, reason }) {
            const supabase = serviceClient();
            const { data: task } = await supabase
              .from("tasks")
              .select("id, title")
              .eq("id", task_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!task) return { error: "Task not found in this property." };
            const { error } = await supabase
              .from("tasks")
              .delete()
              .eq("id", task_id)
              .eq("property_id", propertyId);
            if (error) return { error: error.message };
            return { deleted: true, title: task.title, reason };
          },
        });
      }

      if (grants.has("escalate_task")) {
        tools.escalate_task = defineTool({
          description:
            "Escalate a task: notifies the right person up the chain (the assignee's manager, else the task's team lead, else the property owners/managers) with your note. Use when someone reports a task is stuck/urgent and needs management attention. Returns who was notified.",
          inputSchema: z.object({
            task_id: z.string().uuid(),
            note: z.string().min(5).max(500),
          }),
          async execute({ task_id, note }) {
            const supabase = serviceClient();
            const { data: task } = await supabase
              .from("tasks")
              .select("id, title, assignee_id, space_id")
              .eq("id", task_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!task) return { error: "Task not found in this property." };

            // Escalation target ladder: assignee's manager → team lead →
            // property owners/managers (deduped, capped).
            const targetIds = new Set<string>();
            if (task.assignee_id) {
              const { data: mrow } = await supabase
                .from("memberships")
                .select("manager_id")
                .eq("property_id", propertyId)
                .eq("user_id", task.assignee_id)
                .maybeSingle();
              if (mrow?.manager_id) targetIds.add(mrow.manager_id);
            }
            if (targetIds.size === 0 && task.space_id) {
              const { data: team } = await supabase
                .from("spaces")
                .select("lead_user_id")
                .eq("id", task.space_id)
                .maybeSingle();
              if (team?.lead_user_id) targetIds.add(team.lead_user_id);
            }
            if (targetIds.size === 0) {
              const { data: mgrs } = await supabase
                .from("memberships")
                .select("user_id, role")
                .eq("property_id", propertyId)
                .in("role", ["owner", "manager"])
                .limit(3);
              for (const m of mgrs ?? []) targetIds.add(m.user_id);
            }
            targetIds.delete(senderId);
            if (targetIds.size === 0) {
              return { error: "No escalation target found (no manager, lead, or owner)." };
            }

            const { data: senderProfile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", senderId)
              .maybeSingle();
            const byName = senderProfile?.full_name ?? "Hotelclaw AI";
            const inserts = Array.from(targetIds).map((uid) => ({
              user_id: uid,
              property_id: propertyId,
              type: "task_escalated",
              payload: {
                taskId: task_id,
                taskTitle: task.title,
                byUserId: senderId,
                byUserName: byName,
                note,
              },
            }));
            const { error } = await supabase.from("notifications").insert(inserts);
            if (error) return { error: error.message };

            const { data: targetProfiles } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", Array.from(targetIds));
            return {
              escalated: true,
              task_title: task.title,
              notified: (targetProfiles ?? []).map((p) => p.full_name).filter(Boolean),
              link: `/p/${propertyId}/tasks/${task_id}`,
            };
          },
        });
      }

      if (grants.has("create_project")) {
        tools.create_project = defineTool({
          description:
            "Create a new project on the board. Optionally place it in a team (fuzzy team-name match) and set color/status. Returns the project link — include it in your reply.",
          inputSchema: z.object({
            name: z.string().min(2).max(200),
            description: z.string().max(2000).optional(),
            team_name: z.string().max(120).optional(),
            color: z
              .enum(["slate", "blue", "green", "amber", "rose", "violet"])
              .default("blue"),
            status: z.enum(["active", "planned"]).default("active"),
          }),
          async execute({ name, description, team_name, color, status }) {
            const supabase = serviceClient();
            let teamId: string | null = null;
            if (team_name) {
              const { data: teams } = await supabase
                .from("spaces")
                .select("id, name")
                .eq("property_id", propertyId);
              const teamNeedle = team_name.trim().toLowerCase();
              const team =
                (teams ?? []).find((t) => t.name.toLowerCase() === teamNeedle) ??
                (teams ?? []).find((t) => t.name.toLowerCase().includes(teamNeedle));
              if (!team) {
                return {
                  error: `No team matches "${team_name}".`,
                  teams: (teams ?? []).map((t) => t.name),
                };
              }
              teamId = team.id;
            }
            const { data: maxRow } = await supabase
              .from("projects")
              .select("position")
              .eq("property_id", propertyId)
              .order("position", { ascending: false })
              .limit(1)
              .maybeSingle();
            const { data: proj, error } = await supabase
              .from("projects")
              .insert({
                property_id: propertyId,
                name,
                description: description ?? null,
                color,
                status,
                position: (maxRow?.position ?? 0) + 1024,
                created_by: userId,
              })
              .select("id")
              .single();
            if (error || !proj) return { error: error?.message ?? "Insert failed." };
            if (teamId) {
              await supabase
                .from("project_spaces")
                .insert({ project_id: proj.id, space_id: teamId })
                .then(() => {});
            }
            return {
              created: true,
              project_id: proj.id,
              name,
              link: `/p/${propertyId}/projects/${proj.id}`,
            };
          },
        });
      }

      if (grants.has("schedule_meeting")) {
        tools.schedule_meeting = defineTool({
          description:
            "Schedule a meeting on the property calendar (title, start time, optional end time and location). Times must include a timezone offset. The sender becomes the host when they're a member. Returns the meeting link.",
          inputSchema: z.object({
            title: z.string().min(2).max(200),
            starts_at: z.iso.datetime({ offset: true }),
            ends_at: z.iso.datetime({ offset: true }).optional(),
            location: z.string().max(300).optional(),
          }),
          async execute({ title, starts_at, ends_at, location }) {
            const supabase = serviceClient();
            const { data: senderMember } = await supabase
              .from("memberships")
              .select("user_id")
              .eq("property_id", propertyId)
              .eq("user_id", senderId)
              .maybeSingle();
            const { data: meeting, error } = await supabase
              .from("meetings")
              .insert({
                property_id: propertyId,
                stream_call_id: `meeting-${crypto.randomUUID()}`,
                title,
                host_id: senderMember ? senderId : userId,
                scheduled_start: starts_at,
                scheduled_end: ends_at ?? null,
                location: location ?? null,
                started_at: starts_at,
              })
              .select("id")
              .single();
            if (error || !meeting) return { error: error?.message ?? "Insert failed." };
            return {
              scheduled: true,
              meeting_id: meeting.id,
              title,
              starts_at,
              link: `/p/${propertyId}/meetings/${meeting.id}`,
            };
          },
        });
      }

      if (grants.has("update_meeting")) {
        tools.update_meeting = defineTool({
          description:
            "Reschedule, retitle, or relocate an UPCOMING meeting (get the id from list_meetings). Meetings that already happened can't be changed.",
          inputSchema: z.object({
            meeting_id: z.string().uuid(),
            title: z.string().min(2).max(200).optional(),
            starts_at: z.iso.datetime({ offset: true }).optional(),
            ends_at: z.iso.datetime({ offset: true }).nullish(),
            location: z.string().max(300).nullish(),
          }),
          async execute({ meeting_id, title, starts_at, ends_at, location }) {
            const supabase = serviceClient();
            const { data: meeting } = await supabase
              .from("meetings")
              .select("id, title, scheduled_start, ended_at")
              .eq("id", meeting_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!meeting) return { error: "Meeting not found in this property." };
            if (meeting.ended_at) return { error: "That meeting already ended — it can't be changed." };
            const patch: Record<string, unknown> = {};
            if (title) patch.title = title;
            if (starts_at) {
              patch.scheduled_start = starts_at;
              patch.started_at = starts_at;
            }
            if (ends_at !== undefined) patch.scheduled_end = ends_at;
            if (location !== undefined) patch.location = location;
            if (Object.keys(patch).length === 0) {
              return { error: "Nothing to update — pass at least one field." };
            }
            const { error } = await supabase
              .from("meetings")
              .update(patch)
              .eq("id", meeting_id)
              .eq("property_id", propertyId);
            if (error) return { error: error.message };
            return {
              updated: true,
              meeting_id,
              changed: Object.keys(patch).filter((k) => k !== "started_at"),
              link: `/p/${propertyId}/meetings/${meeting_id}`,
            };
          },
        });
      }

      if (grants.has("cancel_meeting")) {
        tools.cancel_meeting = defineTool({
          // Approval-gated: the SYSTEM parks this call and the channel shows an
          // action preview before it runs (channel-delivery.ts). Proportional
          // friction — outward-facing or hard-to-undo actions only; creating a
          // task or a doc stays unblocked.
          approval: always(),
          description:
            "Cancel (delete) an UPCOMING meeting from the calendar. Confirm with the requester before calling — this removes the meeting for everyone. Meetings that already happened can't be cancelled.",
          inputSchema: z.object({
            meeting_id: z.string().uuid(),
          }),
          async execute({ meeting_id }) {
            const supabase = serviceClient();
            const { data: meeting } = await supabase
              .from("meetings")
              .select("id, title, ended_at")
              .eq("id", meeting_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!meeting) return { error: "Meeting not found in this property." };
            if (meeting.ended_at) return { error: "That meeting already ended — it can't be cancelled." };
            const { error } = await supabase
              .from("meetings")
              .delete()
              .eq("id", meeting_id)
              .eq("property_id", propertyId);
            if (error) return { error: error.message };
            return { cancelled: true, title: meeting.title };
          },
        });
      }

      if (grants.has("create_booking")) {
        tools.create_booking = defineTool({
          description:
            "Create a booking through the REAL availability engine (revalidates the slot, assigns tables, emits workflow events — never a raw insert). service_name is fuzzy-matched against the property's bookable services. starts_at without an offset is wall time in the SERVICE's timezone. On a full slot you get alternatives back — offer them. Confirm details with the requester before booking.",
          inputSchema: z.object({
            service_name: z.string().min(2).max(200),
            starts_at: z.string().min(10).describe("ISO start, e.g. 2026-07-24T19:00 (service-local) or with offset"),
            party_size: z.number().int().min(1).max(200),
            guest_name: z.string().min(1).max(200),
            guest_phone: z.string().max(40).optional(),
            notes: z.string().max(1000).optional(),
            duration_minutes: z.number().int().min(15).max(1440).optional(),
          }),
          async execute({ service_name, starts_at, party_size, guest_name, guest_phone, notes, duration_minutes }) {
            const supabase = serviceClient();
            const { data: services } = await supabase
              .from("bookable_services")
              .select("id, name")
              .eq("property_id", propertyId)
              .eq("active", true);
            const svcNeedle = service_name.trim().toLowerCase();
            const svc =
              (services ?? []).find((s) => s.name.toLowerCase() === svcNeedle) ??
              (services ?? []).find((s) => s.name.toLowerCase().includes(svcNeedle));
            if (!svc) {
              return {
                error: `No bookable service matches "${service_name}".`,
                services: (services ?? []).map((s) => s.name),
              };
            }
            const response = await fetch(`${eveSelfOrigin()}/api/internal/bookings`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({
                propertyId,
                serviceId: svc.id,
                startsAt: starts_at,
                partySize: party_size,
                guestName: guest_name,
                guestPhone: guest_phone ?? null,
                notes: notes ?? null,
                durationMinutes: duration_minutes ?? null,
              }),
              signal: AbortSignal.timeout(30_000),
            }).catch(() => null);
            if (!response) return { error: "Booking service unreachable." };
            const body = (await response.json().catch(() => null)) as {
              error?: string;
              alternatives?: unknown[];
              booking?: Record<string, unknown>;
            } | null;
            if (!response.ok || !body?.booking) {
              return {
                error: body?.error ?? `Booking failed (${response.status}).`,
                alternatives: body?.alternatives ?? [],
              };
            }
            return {
              booked: true,
              service: svc.name,
              ...body.booking,
              link: `/p/${propertyId}/bookings`,
            };
          },
        });
      }

      if (grants.has("update_booking_status")) {
        tools.update_booking_status = defineTool({
          // Approval-gated: the SYSTEM parks this call and the channel shows an
          // action preview before it runs (channel-delivery.ts). Proportional
          // friction — outward-facing or hard-to-undo actions only; creating a
          // task or a doc stays unblocked.
          approval: always(),
          description:
            "Move a booking through its lifecycle by reference (BKG-XXXXXX): pending→confirmed/cancelled, confirmed→seated/completed/no_show/cancelled, seated→completed. Get references from list_bookings. Cancelling emits the booking.cancelled workflow event.",
          inputSchema: z.object({
            reference: z.string().min(4).max(20),
            status: z.enum(["confirmed", "seated", "completed", "no_show", "cancelled"]),
          }),
          async execute({ reference, status }) {
            const response = await fetch(`${eveSelfOrigin()}/api/internal/bookings`, {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({ propertyId, reference, status }),
              signal: AbortSignal.timeout(20_000),
            }).catch(() => null);
            if (!response) return { error: "Booking service unreachable." };
            const body = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            if (!response.ok) {
              return { error: body?.error ?? `Status change failed (${response.status}).` };
            }
            return { updated: true, reference, status, link: `/p/${propertyId}/bookings` };
          },
        });
      }

      if (grants.has("read_sheet")) {
        tools.read_sheet = defineTool({
          description:
            "Read a SPREADSHEET document's live cells as an A1 grid (list_documents shows which docs are sheets). Use before answering questions about sheet data and ALWAYS before update_sheet_cells. sheet_title picks a tab; omit for the first tab.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            sheet_title: z.string().max(120).optional(),
          }),
          async execute({ document_id, sheet_title }) {
            const response = await fetch(
              `${eveSelfOrigin()}/api/internal/sheets?propertyId=${encodeURIComponent(propertyId)}&documentId=${encodeURIComponent(document_id)}`,
              {
                headers: {
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                signal: AbortSignal.timeout(25_000),
              },
            ).catch(() => null);
            if (!response?.ok) {
              const detail = response
                ? ((await response.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Sheet read failed (${response?.status ?? "unreachable"}).` };
            }
            const body = (await response.json()) as {
              title: string;
              workbook: {
                sheets: Array<{
                  title: string;
                  columns: Array<{ id: string }>;
                  rows: Array<{ id: string }>;
                  cells: Record<string, string>;
                }>;
              };
            };
            const tabNeedle = (sheet_title ?? "").trim().toLowerCase();
            const tab = tabNeedle
              ? body.workbook.sheets.find((s) => s.title.toLowerCase() === tabNeedle)
              : body.workbook.sheets[0];
            if (!tab) {
              return {
                error: `No sheet tab named "${sheet_title}".`,
                tabs: body.workbook.sheets.map((s) => s.title),
              };
            }
            // colId/rowId → A1. Column letters follow array order.
            const colLetter = (n: number) => {
              let s = "";
              let i = n;
              do {
                s = String.fromCharCode(65 + (i % 26)) + s;
                i = Math.floor(i / 26) - 1;
              } while (i >= 0);
              return s;
            };
            const colIndexById = new Map(tab.columns.map((c, i) => [c.id, i]));
            const rowIndexById = new Map(tab.rows.map((r, i) => [r.id, i]));
            const grid: Record<string, string> = {};
            let dropped = 0;
            for (const [cellKey, cellValue] of Object.entries(tab.cells)) {
              const at = cellKey.indexOf("@");
              const ci = colIndexById.get(cellKey.slice(0, at));
              const ri = rowIndexById.get(cellKey.slice(at + 1));
              if (ci === undefined || ri === undefined) continue;
              if (Object.keys(grid).length >= 800) {
                dropped += 1;
                continue;
              }
              grid[`${colLetter(ci)}${ri + 1}`] = cellValue;
            }
            return {
              title: body.title,
              tab: tab.title,
              tabs: body.workbook.sheets.map((s) => s.title),
              dimensions: `${tab.columns.length} cols × ${tab.rows.length} rows`,
              cells: grid,
              truncated_cells: dropped,
              link: `/p/${propertyId}/documents/${document_id}`,
            };
          },
        });
      }

      if (grants.has("update_sheet_cells")) {
        tools.update_sheet_cells = defineTool({
          description:
            "Write values into a SPREADSHEET document's cells (A1 references, ≤200 per call) — changes land LIVE for anyone viewing the sheet. ALWAYS read_sheet first so you write the right cells. An artifact card appears in the channel so people can watch. Values are plain strings; formulas are written as-is.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            sheet_title: z.string().max(120).optional(),
            cells: z
              .array(z.object({ ref: z.string().min(2).max(8), value: z.string().max(2000) }))
              .min(1)
              .max(200),
          }),
          async execute({ document_id, sheet_title, cells }, toolCtx) {
            const supabase = serviceClient();
            const { data: doc } = await supabase
              .from("documents")
              .select("id, title, kind")
              .eq("id", document_id)
              .eq("property_id", propertyId)
              .maybeSingle();
            if (!doc || doc.kind !== "sheet") {
              return { error: "Spreadsheet not found in this property." };
            }

            const cardId = `eve-artifact-${toolCtx.callId}`;
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const streamSecret = process.env.STREAM_API_SECRET;
            let cardPosted = false;
            if (apiKey && streamSecret && sessionChannelId) {
              const { data: chatRow } = await supabase
                .from("channel_bot_sessions")
                .select("channel_type, turn_nonce")
                .eq("eve_session_id", eveSessionId)
                .maybeSingle();
              const server = StreamChat.getInstance(apiKey, streamSecret, {
                timeout: 15_000,
              });
              await server
                .channel(chatRow?.channel_type ?? "team", sessionChannelId)
                .sendMessage({
                  id: cardId,
                  text: "",
                  user_id: process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                  ai_generated: true,
                  // Groups this card with the rest of the turn (see eveSessionId).
                  eve_turn: chatRow?.turn_nonce ?? undefined,
                  attachments: [
                    {
                      type: "app_artifact",
                      kind: "sheet",
                      status: "writing",
                      title: doc.title,
                      property_id: propertyId,
                      document_id,
                    },
                  ],
                } as unknown as Parameters<ReturnType<StreamChat["channel"]>["sendMessage"]>[0])
                .then(() => {
                  cardPosted = true;
                })
                .catch(() => {});
            }

            const response = await fetch(`${eveSelfOrigin()}/api/internal/sheets`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({
                propertyId,
                documentId: document_id,
                sheetTitle: sheet_title ?? null,
                cells,
              }),
              signal: AbortSignal.timeout(45_000),
            }).catch(() => null);
            const body = response
              ? ((await response.json().catch(() => null)) as {
                  error?: string;
                  written?: number;
                  sheetTitle?: string;
                } | null)
              : null;

            if (cardPosted) {
              const server2 = StreamChat.getInstance(
                process.env.NEXT_PUBLIC_STREAM_API_KEY ?? "",
                process.env.STREAM_API_SECRET ?? "",
                { timeout: 15_000 },
              );
              await server2
                .partialUpdateMessage(
                  cardId,
                  {
                    set: {
                      attachments: [
                        {
                          type: "app_artifact",
                          kind: "sheet",
                          status: "done",
                          action: "edited",
                          title: doc.title,
                          property_id: propertyId,
                          document_id,
                          href: `/p/${propertyId}/documents/${document_id}`,
                        },
                      ],
                    },
                  } as unknown as Parameters<typeof server2.partialUpdateMessage>[1],
                  process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                )
                .catch(() => {});
            }

            if (!response?.ok || !body || body.error) {
              return { error: body?.error ?? `Sheet write failed (${response?.status ?? "unreachable"}).` };
            }
            return {
              written: body.written,
              tab: body.sheetTitle,
              link: `/p/${propertyId}/documents/${document_id}`,
            };
          },
        });
      }

      if (grants.has("create_form")) {
        tools.create_form = defineTool({
          description:
            "Create a form with typed fields (short_text, long_text, email, phone, number, select, multi_select, yes_no, rating, date, section). select/multi_select need options. Created as DRAFT unless publish=true. Returns the builder link.",
          inputSchema: z.object({
            title: z.string().min(2).max(200),
            description: z.string().max(1000).optional(),
            publish: z.boolean().default(false),
            fields: z
              .array(
                z.object({
                  label: z.string().min(1).max(200),
                  type: z.enum([
                    "short_text",
                    "long_text",
                    "email",
                    "phone",
                    "number",
                    "select",
                    "multi_select",
                    "yes_no",
                    "rating",
                    "date",
                    "section",
                  ]),
                  required: z.boolean().default(false),
                  options: z.array(z.string().min(1).max(120)).max(20).optional(),
                }),
              )
              .min(1)
              .max(30),
          }),
          async execute({ title, description, publish, fields }) {
            const supabase = serviceClient();
            for (const f of fields) {
              if (
                (f.type === "select" || f.type === "multi_select") &&
                (!f.options || f.options.length < 2)
              ) {
                return { error: `Field "${f.label}" is a ${f.type} and needs at least 2 options.` };
              }
            }
            // Server-assigned stable field ids (answer keys).
            const schemaFields = fields.map((f, i) => ({
              id: `f${i + 1}_${crypto.randomUUID().slice(0, 6)}`,
              type: f.type,
              label: f.label,
              required: f.required && f.type !== "section",
              ...(f.options
                ? {
                    options: f.options.map((opt, j) => ({
                      id: `o${j + 1}_${crypto.randomUUID().slice(0, 4)}`,
                      label: opt,
                    })),
                  }
                : {}),
            }));
            const { data: form, error } = await supabase
              .from("forms")
              .insert({
                property_id: propertyId,
                title,
                description: description ?? null,
                schema: { version: 1, fields: schemaFields },
                status: publish ? "published" : "draft",
                created_by: userId,
              })
              .select("id")
              .single();
            if (error || !form) return { error: error?.message ?? "Insert failed." };
            return {
              created: true,
              form_id: form.id,
              status: publish ? "published" : "draft",
              field_count: schemaFields.length,
              link: `/p/${propertyId}/forms/${form.id}`,
            };
          },
        });
      }

      if (grants.has("set_form_status")) {
        tools.set_form_status = defineTool({
          description:
            "Publish, close, or re-draft a form (get the id from list_forms). Published forms accept responses; closed forms stop accepting them.",
          inputSchema: z.object({
            form_id: z.string().uuid(),
            status: z.enum(["draft", "published", "closed"]),
          }),
          async execute({ form_id, status }) {
            const supabase = serviceClient();
            const { data: form } = await supabase
              .from("forms")
              .select("id, title, status")
              .eq("id", form_id)
              .eq("property_id", propertyId)
              .is("archived_at", null)
              .maybeSingle();
            if (!form) return { error: "Form not found in this property." };
            if (form.status === status) {
              return { unchanged: true, title: form.title, status };
            }
            const { error } = await supabase
              .from("forms")
              .update({ status })
              .eq("id", form_id)
              .eq("property_id", propertyId);
            if (error) return { error: error.message };
            return {
              updated: true,
              title: form.title,
              status,
              link: `/p/${propertyId}/forms/${form_id}`,
            };
          },
        });
      }

      if (grants.has("share_form_to_channel") && sessionChannelId) {
        tools.share_form_to_channel = defineTool({
          description:
            "Post a PUBLISHED form into this channel as a fill-in-place card (same card the app's Share button posts). Get the id from list_forms; publish drafts first with set_form_status.",
          inputSchema: z.object({
            form_id: z.string().uuid(),
            message: z.string().max(300).optional().describe("Optional line above the card."),
          }),
          async execute({ form_id, message }) {
            const supabase = serviceClient();
            const { data: form } = await supabase
              .from("forms")
              .select("id, title, description, status, schema")
              .eq("id", form_id)
              .eq("property_id", propertyId)
              .is("archived_at", null)
              .maybeSingle();
            if (!form) return { error: "Form not found in this property." };
            if (form.status !== "published") {
              return { error: `"${form.title}" is ${form.status} — publish it first (set_form_status).` };
            }
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const streamSecret = process.env.STREAM_API_SECRET;
            if (!apiKey || !streamSecret) return { error: "Chat credentials missing." };
            const { data: chatRow } = await supabase
              .from("channel_bot_sessions")
              .select("channel_type, turn_nonce")
              .eq("eve_session_id", eveSessionId)
              .maybeSingle();
            const server = StreamChat.getInstance(apiKey, streamSecret, { timeout: 15_000 });
            const fieldTotal = Array.isArray(
              (form.schema as { fields?: unknown[] } | null)?.fields,
            )
              ? ((form.schema as { fields: unknown[] }).fields.length)
              : 0;
            const sent = await server
              .channel(chatRow?.channel_type ?? "team", sessionChannelId)
              .sendMessage({
                text: message ?? "",
                user_id: process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                ai_generated: true,
                // Groups this card with the rest of the turn (see eveSessionId).
                eve_turn: chatRow?.turn_nonce ?? undefined,
                attachments: [
                  {
                    type: "form",
                    form_id: form.id,
                    property_id: propertyId,
                    title: form.title,
                    description: form.description ?? undefined,
                    field_count: fieldTotal,
                  },
                ],
              } as unknown as Parameters<ReturnType<StreamChat["channel"]>["sendMessage"]>[0])
              .catch((err: unknown) => ({ err }));
            if (sent && "err" in sent) return { error: "Posting the form card failed." };
            return { shared: true, title: form.title, field_count: fieldTotal };
          },
        });
      }

      if (grants.has("send_notification")) {
        tools.send_notification = defineTool({
          // Approval-gated: the SYSTEM parks this call and the channel shows an
          // action preview before it runs (channel-delivery.ts). Proportional
          // friction — outward-facing or hard-to-undo actions only; creating a
          // task or a doc stays unblocked.
          approval: always(),
          description:
            "Send an in-app notification to a named person or a whole team (fuzzy name match; on no match you get valid names back). Use for 'remind X to…', 'let the kitchen team know…'. The notification shows who asked for it.",
          inputSchema: z.object({
            person_name: z.string().max(120).optional(),
            team_name: z.string().max(120).optional(),
            message: z.string().min(3).max(500),
          }),
          async execute({ person_name, team_name, message }) {
            if (!person_name && !team_name) {
              return { error: "Pass person_name or team_name." };
            }
            const supabase = serviceClient();
            const targetIds = new Set<string>();
            let targetLabel = "";
            if (person_name) {
              const { data: members } = await supabase
                .from("memberships")
                .select("user_id")
                .eq("property_id", propertyId);
              const ids = (members ?? []).map((m) => m.user_id);
              const { data: profiles } = ids.length
                ? await supabase.from("profiles").select("id, full_name").in("id", ids)
                : { data: [] };
              const needle = person_name.trim().toLowerCase();
              const match =
                (profiles ?? []).find((p) => (p.full_name ?? "").toLowerCase() === needle) ??
                (profiles ?? []).find((p) =>
                  (p.full_name ?? "").toLowerCase().includes(needle),
                );
              if (!match) {
                return {
                  error: `No member matches "${person_name}".`,
                  members: (profiles ?? []).map((p) => p.full_name).filter(Boolean),
                };
              }
              targetIds.add(match.id);
              targetLabel = match.full_name ?? person_name;
            } else if (team_name) {
              const { data: teams } = await supabase
                .from("spaces")
                .select("id, name")
                .eq("property_id", propertyId);
              const teamNeedle = team_name.trim().toLowerCase();
              const team =
                (teams ?? []).find((t) => t.name.toLowerCase() === teamNeedle) ??
                (teams ?? []).find((t) => t.name.toLowerCase().includes(teamNeedle));
              if (!team) {
                return {
                  error: `No team matches "${team_name}".`,
                  teams: (teams ?? []).map((t) => t.name),
                };
              }
              const { data: teamMembers } = await supabase
                .from("space_members")
                .select("user_id")
                .eq("space_id", team.id);
              for (const m of teamMembers ?? []) targetIds.add(m.user_id);
              targetLabel = team.name;
              if (targetIds.size === 0) {
                return { error: `Team "${team.name}" has no members.` };
              }
            }
            targetIds.delete(senderId);
            if (targetIds.size === 0) {
              return { error: "The only match is the requester themself." };
            }
            const { data: senderProfile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", senderId)
              .maybeSingle();
            const { error } = await supabase.from("notifications").insert(
              Array.from(targetIds).map((uid) => ({
                user_id: uid,
                property_id: propertyId,
                type: "ai_message",
                payload: {
                  message,
                  byUserId: senderId,
                  byUserName: senderProfile?.full_name ?? "Hotelclaw AI",
                },
              })),
            );
            if (error) return { error: error.message };
            return { sent: true, to: targetLabel, recipients: targetIds.size };
          },
        });
      }

      if (grants.has("list_channels")) {
        tools.list_channels = defineTool({
          description:
            "List this property's chat channels — name and channel_id — scoped to channels the REQUESTING PERSON is a member of. Use this to turn a channel NAME the person said ('post it in #announcements') into the channel_id that post_to_channel needs. Without it there is no way to address any channel but the current one.",
          inputSchema: z.object({
            name_contains: z
              .string()
              .max(80)
              .optional()
              .describe("Optional filter on the channel name, e.g. 'announce'"),
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ name_contains, limit }) {
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const secret = process.env.STREAM_API_SECRET;
            if (!apiKey || !secret) return { error: "Chat not configured." };
            try {
              const server = StreamChat.getInstance(apiKey, secret, { timeout: 15_000 });
              // Same tenancy shape as search_chat_messages: property custom
              // field AND the SENDER's membership. A non-member sender sees
              // nothing, so this can never enumerate channels on behalf of
              // the owner-fallback acting principal.
              const channels = await server.queryChannels(
                {
                  type: { $in: ["team", "messaging"] },
                  property_id: propertyId,
                  members: { $in: [senderId] },
                } as Parameters<typeof server.queryChannels>[0],
                { last_message_at: -1 },
                { limit, state: false, watch: false },
              );
              const needle = name_contains?.toLowerCase();
              const rows = channels
                .map((c) => ({
                  channel_id: c.id ?? null,
                  name: (c.data?.name as string | undefined) ?? c.id ?? "",
                }))
                .filter((c) => c.channel_id)
                .filter((c) => !needle || c.name.toLowerCase().includes(needle));
              return { count: rows.length, channels: rows };
            } catch (e) {
              return { error: e instanceof Error ? e.message : "channel list failed" };
            }
          },
        });
      }

      if (grants.has("post_to_channel")) {
        tools.post_to_channel = defineTool({
          // Approval-gated: the SYSTEM parks this call and the channel shows an
          // action preview before it runs (channel-delivery.ts). Proportional
          // friction — outward-facing or hard-to-undo actions only; creating a
          // task or a doc stays unblocked.
          approval: always(),
          description:
            "Post a message to ANOTHER channel in this property as the AI (e.g. relay an announcement to #general). channel_id is the Stream channel id — when the person names a channel rather than giving an id, call list_channels first to resolve it. Only this property's channels are allowed.",
          inputSchema: z.object({
            channel_id: z.string().min(6).max(120),
            message: z.string().min(1).max(3000),
          }),
          async execute({ channel_id, message }) {
            // Tenancy guard: property channel ids are minted as
            // prop-<first 8 of property uuid>-… — anything else is another
            // property's channel (or not ours to post in).
            if (!channel_id.startsWith(`prop-${propertyId.slice(0, 8)}`)) {
              return { error: "That channel doesn't belong to this property." };
            }
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const streamSecret = process.env.STREAM_API_SECRET;
            if (!apiKey || !streamSecret) return { error: "Chat credentials missing." };
            const server = StreamChat.getInstance(apiKey, streamSecret, { timeout: 15_000 });
            const found = await server
              .queryChannels({ id: channel_id }, {}, { limit: 1 })
              .catch(() => []);
            if (!found.length) return { error: "Channel not found." };
            const sent = await found[0]
              .sendMessage({
                text: message,
                user_id: process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai",
                ai_generated: true,
              } as unknown as Parameters<(typeof found)[0]["sendMessage"]>[0])
              .catch((err: unknown) => ({ err }));
            if (sent && "err" in sent) return { error: "Posting failed." };
            return { posted: true, channel_id };
          },
        });
      }

      if (grants.has("list_workflows")) {
        tools.list_workflows = defineTool({
          description:
            "List the property's workflow automations: name, enabled, trigger, last run. Workflows whose trigger is 'Manual run' can be started with trigger_workflow.",
          inputSchema: z.object({}),
          async execute() {
            const supabase = serviceClient();
            const { data: rows, error } = await supabase
              .from("workflows")
              .select("id, name, description, enabled, current_version_id, last_run_at, last_run_status")
              .eq("property_id", propertyId)
              .is("archived_at", null)
              .order("updated_at", { ascending: false })
              .limit(40);
            if (error) return { error: error.message };
            const versionIds = (rows ?? [])
              .map((w) => w.current_version_id)
              .filter((v): v is string => !!v);
            const { data: versions } = versionIds.length
              ? await supabase
                  .from("workflow_versions")
                  .select("id, spec")
                  .in("id", versionIds)
              : { data: [] };
            const triggerByVersion = new Map(
              (versions ?? []).map((v) => [
                v.id,
                ((v.spec as { trigger?: { event_type?: string } } | null)?.trigger
                  ?.event_type ?? null) as string | null,
              ]),
            );
            return {
              count: (rows ?? []).length,
              workflows: (rows ?? []).map((w) => ({
                name: w.name,
                description: w.description,
                enabled: w.enabled,
                trigger: w.current_version_id
                  ? triggerByVersion.get(w.current_version_id)
                  : null,
                manually_triggerable:
                  w.enabled &&
                  triggerByVersion.get(w.current_version_id ?? "") === "manual.run",
                last_run_at: w.last_run_at,
                last_run_status: w.last_run_status,
              })),
            };
          },
        });
      }

      if (grants.has("trigger_workflow")) {
        tools.trigger_workflow = defineTool({
          description:
            "Start a workflow whose trigger is 'Manual run' (check list_workflows — only enabled + manual.run workflows can be triggered). The run is queued through the same dispatcher the app's Run button uses.",
          inputSchema: z.object({
            workflow_name: z.string().min(2).max(200),
          }),
          async execute({ workflow_name }) {
            const supabase = serviceClient();
            const { data: rows } = await supabase
              .from("workflows")
              .select("id, name, enabled, current_version_id")
              .eq("property_id", propertyId)
              .is("archived_at", null);
            const wfNeedle = workflow_name.trim().toLowerCase();
            const wf =
              (rows ?? []).find((w) => w.name.toLowerCase() === wfNeedle) ??
              (rows ?? []).find((w) => w.name.toLowerCase().includes(wfNeedle));
            if (!wf) {
              return {
                error: `No workflow matches "${workflow_name}".`,
                workflows: (rows ?? []).map((w) => w.name),
              };
            }
            if (!wf.enabled) return { error: `"${wf.name}" is disabled — enable it in Workflows first.` };
            const { data: version } = wf.current_version_id
              ? await supabase
                  .from("workflow_versions")
                  .select("spec")
                  .eq("id", wf.current_version_id)
                  .maybeSingle()
              : { data: null };
            const triggerType = (version?.spec as { trigger?: { event_type?: string } } | null)
              ?.trigger?.event_type;
            if (triggerType !== "manual.run") {
              return {
                error: `"${wf.name}" is triggered by ${triggerType ?? "an event"}, not manually — it runs on its own when that happens.`,
              };
            }
            // Same emission as the app's manual-run route; the dispatcher
            // cron picks the event up within a minute.
            const { error } = await supabase.from("workflow_events").insert({
              property_id: propertyId,
              source: "manual",
              event_type: "manual.run",
              entity_id: wf.id,
              entity_kind: "workflow",
              payload: { run_by_user_id: senderId, workflow_id: wf.id, input: {} },
            });
            if (error) return { error: error.message };
            return {
              triggered: true,
              name: wf.name,
              note: "Run queued — it starts within a minute.",
              link: `/p/${propertyId}/workflows/${wf.id}`,
            };
          },
        });
      }

      if (grants.has("restore_document_revision")) {
        tools.restore_document_revision = defineTool({
          description:
            "UNDO an AI document replace: list a doc's stashed pre-replace revisions (call without revision_id) and restore one (call with revision_id — the current body is stashed first, so a restore is itself undoable). Only docs the AI has replaced have revisions.",
          inputSchema: z.object({
            document_id: z.string().uuid(),
            revision_id: z.string().uuid().optional(),
          }),
          async execute({ document_id, revision_id }) {
            const listResponse = await fetch(
              `${eveSelfOrigin()}/api/internal/documents/read?propertyId=${encodeURIComponent(propertyId)}&documentId=${encodeURIComponent(document_id)}&revisions=1`,
              {
                headers: {
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                signal: AbortSignal.timeout(20_000),
              },
            ).catch(() => null);
            if (!listResponse?.ok) {
              return { error: `Revision list failed (${listResponse?.status ?? "unreachable"}).` };
            }
            const listBody = (await listResponse.json()) as {
              revisions: Array<{ id: string; replaced_at: string; preview: string; characters: number }>;
            };
            if (!revision_id) {
              return {
                revisions: listBody.revisions,
                note: listBody.revisions.length
                  ? "Call again with revision_id to restore one."
                  : "No stashed revisions for this document.",
              };
            }
            if (!listBody.revisions.some((r) => r.id === revision_id)) {
              return { error: "That revision doesn't belong to this document.", revisions: listBody.revisions };
            }
            const revResponse = await fetch(
              `${eveSelfOrigin()}/api/internal/documents/read?propertyId=${encodeURIComponent(propertyId)}&documentId=${encodeURIComponent(document_id)}&revisionId=${encodeURIComponent(revision_id)}`,
              {
                headers: {
                  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
                },
                signal: AbortSignal.timeout(20_000),
              },
            ).catch(() => null);
            if (!revResponse?.ok) {
              return { error: `Revision read failed (${revResponse?.status ?? "unreachable"}).` };
            }
            const revBody = (await revResponse.json()) as { html: string };
            if (!revBody.html) return { error: "Revision has no restorable content." };
            const writeResponse = await fetch(`${eveSelfOrigin()}/api/internal/documents/write`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({
                propertyId,
                documentId: document_id,
                html: revBody.html,
                mode: "replace",
                actorUserId: userId,
              }),
              signal: AbortSignal.timeout(55_000),
            }).catch(() => null);
            if (!writeResponse?.ok) {
              const detail = writeResponse
                ? ((await writeResponse.json().catch(() => null)) as { error?: string } | null)
                : null;
              return { error: detail?.error ?? `Restore write failed (${writeResponse?.status ?? "unreachable"}).` };
            }
            return {
              restored: true,
              revision_id,
              link: `/p/${propertyId}/documents/${document_id}`,
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
