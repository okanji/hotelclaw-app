import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { StreamChat } from "stream-chat";
import { serviceClient } from "../lib/supabase";
import { resolvePodContext } from "../lib/pods";

// Pod-bot tool surface (fleet spec M2). Built per session from the
// addressed bot's `tool_set` allow-list — a tool not in the list does not
// exist for that bot (spec acceptance: `housekeeping` lacks the approval-gated money tools).
// Sessions without a pod bot get no pod tools (the Agents-section catalog
// in catalog.ts covers custom agents).
//
// eve constraint: every `execute` INLINE (replay reconstruction).
// Tenancy constraint: every query filters by the session's verified
// property/client — never by model-supplied ids.

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const pod = await resolvePodContext(ctx);
      if (!pod?.bot) return null;
      const { caller, bot } = pod;
      const propertyId = caller.propertyId;
      const userId = caller.userId;
      const allowed = bot.toolSet;

      const tools: Record<string, unknown> = {};

      if (allowed.has("list_tasks")) {
        tools.list_tasks = defineTool({
          description:
            "List tasks in this property. Filter by status; returns title, status, priority, due date.",
          inputSchema: z.object({
            status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
            limit: z.number().int().min(1).max(30).default(15),
          }),
          async execute({ status, limit }) {
            let query = serviceClient()
              .from("tasks")
              .select("id, title, status, priority, due_at, status_ref:statuses!tasks_status_id_fkey(name)")
              .eq("property_id", propertyId)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (status) query = query.eq("status", status);
            const { data, error } = await query;
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              tasks: (data ?? []).map((t) => {
                const sref = (Array.isArray(t.status_ref) ? t.status_ref[0] : t.status_ref) as
                  | { name?: string }
                  | null
                  | undefined;
                return {
                  id: t.id,
                  title: t.title,
                  status: sref?.name ?? STATUS_LABELS[t.status] ?? t.status,
                  status_category: t.status,
                  priority: t.priority,
                  due: t.due_at,
                };
              }),
            };
          },
        });
      }

      if (allowed.has("create_task")) {
        tools.create_task = defineTool({
          description:
            "Create a task in this property's board. Returns the new task id and title.",
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

      if (allowed.has("update_task")) {
        tools.update_task = defineTool({
          description:
            "Update a task's status or priority by id. Only tasks in this property can be touched.",
          inputSchema: z.object({
            task_id: z.string().uuid(),
            status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          }),
          async execute({ task_id, status, priority }) {
            if (!status && !priority) return { error: "Nothing to update." };
            const { data, error } = await serviceClient()
              .from("tasks")
              .update({
                ...(status ? { status } : {}),
                ...(priority ? { priority } : {}),
              })
              .eq("id", task_id)
              .eq("property_id", propertyId)
              .select("id, title, status, priority")
              .maybeSingle();
            if (error) return { error: error.message };
            if (!data) return { error: "Task not found in this property." };
            return { updated: true, task: data };
          },
        });
      }

      if (allowed.has("search_docs")) {
        tools.search_docs = defineTool({
          description:
            "Full-text search over this property's app documents (SOPs, notes). Returns title + preview per match. Distinct from property memory (recalled above each turn; property__search for more), which holds institutional knowledge rather than authored documents.",
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

      if (allowed.has("read_doc")) {
        tools.read_doc = defineTool({
          description: "Read an app document's full text by id (from search_docs results).",
          inputSchema: z.object({ document_id: z.string().uuid() }),
          async execute({ document_id }) {
            const { data, error } = await serviceClient()
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

      if (allowed.has("notify_channel")) {
        tools.notify_channel = defineTool({
          description:
            "Post a message into one of this property's team chat channels. Use for briefs, alerts, and escalations — not for chatty replies.",
          inputSchema: z.object({
            channel_id: z.string().min(1).max(120),
            text: z.string().min(1).max(4000),
          }),
          async execute({ channel_id, text }) {
            const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
            const secret = process.env.STREAM_API_SECRET;
            if (!apiKey || !secret) return { error: "Stream not configured." };
            // Channel ids are property-prefixed (prop-<id fragment>-…); only
            // allow posting into this property's channels.
            const prefix = `prop-${propertyId.slice(0, 8)}`;
            if (!channel_id.startsWith(prefix)) {
              return { error: `Channel must belong to this property (${prefix}-…).` };
            }
            const server = StreamChat.getInstance(apiKey, secret, { timeout: 15000 });
            const botUser = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
            const channel = server.channel("team", channel_id);
            const sent = await channel.sendMessage({
              text,
              user_id: botUser,
            });
            return { posted: true, message_id: sent.message.id };
          },
        });
      }

      if (allowed.has("override_rate")) {
        tools.override_rate = defineTool({
          description:
            "Record a rate override beyond the published discretion band. Money-moving: the SYSTEM parks every call for human approval automatically — call it directly when an override is requested rather than asking permission in chat.",
          approval: always(),
          inputSchema: z.object({
            booking_reference: z.string().min(4).max(20).optional(),
            description: z.string().min(10).max(500),
            new_rate: z.string().min(1).max(60).describe("The overridden rate, as quoted"),
          }),
          async execute({ booking_reference, description, new_rate }) {
            const { data, error } = await serviceClient()
              .from("tasks")
              .insert({
                property_id: propertyId,
                title: `Rate override approved: ${new_rate}${booking_reference ? ` (${booking_reference})` : ""}`,
                description: `Approved via ${bot.displayName} bot. ${description}`,
                priority: "high",
                source: "ai",
                created_by: userId,
              })
              .select("id")
              .single();
            if (error) return { error: error.message };
            return { recorded: true, follow_up_task: data.id };
          },
        });
      }

      if (allowed.has("comp_night")) {
        tools.comp_night = defineTool({
          description:
            "Record a complimentary night for a guest/booking. Money-moving: the SYSTEM parks every call for human approval automatically — call it directly when a comp is requested rather than asking permission in chat.",
          approval: always(),
          inputSchema: z.object({
            booking_reference: z.string().min(4).max(20),
            reason: z.string().min(10).max(500),
          }),
          async execute({ booking_reference, reason }) {
            // The reference is recorded as given — the bookings tables are
            // no longer read by the app (Bookings removed 2026-10-29).
            const reference = booking_reference.toUpperCase();
            const { data, error } = await serviceClient()
              .from("tasks")
              .insert({
                property_id: propertyId,
                title: `Comp night approved for ${reference}`,
                description: `Approved via ${bot.displayName} bot. Reason: ${reason}`,
                priority: "high",
                source: "ai",
                created_by: userId,
              })
              .select("id")
              .single();
            if (error) return { error: error.message };
            return { recorded: true, reference, follow_up_task: data.id };
          },
        });
      }

      return tools;
    },
  },
});
