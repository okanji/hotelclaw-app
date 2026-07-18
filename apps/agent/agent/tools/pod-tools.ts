import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { StreamChat } from "stream-chat";
import { serviceClient } from "../lib/supabase";
import { resolvePodContext } from "../lib/pods";
import { brainQuery, getBrainPage, putBrainPage } from "../lib/gbrain-http";

// Pod-bot tool surface (fleet spec M2). Built per session from the
// addressed bot's `tool_set` allow-list — a tool not in the list does not
// exist for that bot (spec acceptance: `housekeeping` lacks refund_booking).
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
      const { caller, bot, brainUrl, brainTokenRef, propertySlug, clientSlug } = pod;
      const propertyId = caller.propertyId;
      const userId = caller.userId;
      const allowed = bot.toolSet;

      const tools: Record<string, ReturnType<typeof defineTool>> = {};

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
              .select("id, title, status, priority, due_at")
              .eq("property_id", propertyId)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (status) query = query.eq("status", status);
            const { data, error } = await query;
            if (error) return { error: error.message };
            return {
              count: (data ?? []).length,
              tasks: (data ?? []).map((t) => ({
                id: t.id,
                title: t.title,
                status: STATUS_LABELS[t.status] ?? t.status,
                priority: t.priority,
                due: t.due_at,
              })),
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
            "Full-text search over this property's app documents (SOPs, notes). Returns title + preview per match. Distinct from the knowledge brain — use brain_query for institutional knowledge.",
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

      if (allowed.has("get_bookings")) {
        tools.get_bookings = defineTool({
          description:
            "List bookings for this property in a date window (default: next 7 days). Returns reference, guest, party, status, start time, service.",
          inputSchema: z.object({
            from: z.string().optional().describe("ISO date, default today"),
            days: z.number().int().min(1).max(60).default(7),
            status: z
              .enum(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"])
              .optional(),
            limit: z.number().int().min(1).max(50).default(25),
          }),
          async execute({ from, days, status, limit }) {
            const start = from ? new Date(`${from}T00:00:00Z`) : new Date();
            const end = new Date(start.getTime() + days * 86_400_000);
            let query = serviceClient()
              .from("bookings")
              .select(
                "reference, guest_name, party_size, status, starts_at, bookable_services(name)",
              )
              .eq("property_id", propertyId)
              .gte("starts_at", start.toISOString())
              .lte("starts_at", end.toISOString())
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
                service: (b.bookable_services as { name?: string } | null)?.name ?? null,
              })),
            };
          },
        });
      }

      if (allowed.has("get_booking")) {
        tools.get_booking = defineTool({
          description: "Fetch one booking by its reference (BKG-XXXXXX).",
          inputSchema: z.object({ reference: z.string().min(4).max(20) }),
          async execute({ reference }) {
            const { data, error } = await serviceClient()
              .from("bookings")
              .select(
                "reference, guest_name, guest_email, party_size, status, starts_at, ends_at, notes, bookable_services(name)",
              )
              .eq("property_id", propertyId)
              .eq("reference", reference.toUpperCase())
              .maybeSingle();
            if (error) return { error: error.message };
            if (!data) return { error: "No booking with that reference here." };
            return { booking: data };
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

      if (allowed.has("refund_booking")) {
        tools.refund_booking = defineTool({
          description:
            "Cancel a booking and record a refund request. Money-moving: the SYSTEM automatically parks every call for human approval before it executes — so when a refund is requested, call this tool directly and let the approval gate do its job. Never ask for permission in chat instead of calling it.",
          approval: always(),
          inputSchema: z.object({
            reference: z.string().min(4).max(20),
            reason: z.string().min(5).max(500),
          }),
          async execute({ reference, reason }) {
            const supabase = serviceClient();
            const { data: booking } = await supabase
              .from("bookings")
              .select("id, reference, status, guest_name")
              .eq("property_id", propertyId)
              .eq("reference", reference.toUpperCase())
              .maybeSingle();
            if (!booking) return { error: "No booking with that reference here." };
            if (booking.status === "cancelled") {
              return { error: "Booking is already cancelled." };
            }
            const { error } = await supabase
              .from("bookings")
              .update({ status: "cancelled" })
              .eq("id", booking.id);
            if (error) return { error: error.message };
            await supabase.from("tasks").insert({
              property_id: propertyId,
              title: `Process refund for ${booking.reference} (${booking.guest_name ?? "guest"})`,
              description: `Approved via ${bot.displayName} bot. Reason: ${reason}`,
              priority: "high",
              status: "todo",
              source: "ai",
              created_by: userId,
            });
            return {
              cancelled: true,
              reference: booking.reference,
              refund_task_created: true,
            };
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
                status: "todo",
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
            const { data: booking } = await serviceClient()
              .from("bookings")
              .select("id, reference, guest_name")
              .eq("property_id", propertyId)
              .eq("reference", booking_reference.toUpperCase())
              .maybeSingle();
            if (!booking) return { error: "No booking with that reference here." };
            const { data, error } = await serviceClient()
              .from("tasks")
              .insert({
                property_id: propertyId,
                title: `Comp night approved for ${booking.reference} (${booking.guest_name ?? "guest"})`,
                description: `Approved via ${bot.displayName} bot. Reason: ${reason}`,
                priority: "high",
                status: "todo",
                source: "ai",
                created_by: userId,
              })
              .select("id")
              .single();
            if (error) return { error: error.message };
            return { recorded: true, reference: booking.reference, follow_up_task: data.id };
          },
        });
      }

      if (allowed.has("brain_query")) {
        tools.brain_query = defineTool({
          description:
            `Query the ${clientSlug} knowledge brain (institutional memory: property systems, guests, suppliers, playbooks, local area). ALWAYS try this before answering property-specific questions. Cite returned page paths as [brain: <path>].`,
          inputSchema: z.object({
            query: z.string().min(2).max(300),
          }),
          async execute({ query }) {
            const result = await brainQuery(brainUrl, brainTokenRef, query);
            if (!result.ok) {
              return {
                unavailable: true,
                reason: result.reason,
                guidance:
                  "The knowledge brain is unreachable. Answer from app tools only and say institutional knowledge is temporarily unavailable.",
              };
            }
            return { result: result.content };
          },
        });
      }

      if (allowed.has("brain_get")) {
        tools.brain_get = defineTool({
          description:
            `Fetch a full page from the ${clientSlug} knowledge brain by path (e.g. properties/${propertySlug}/welcome-book).`,
          inputSchema: z.object({ path: z.string().min(2).max(300) }),
          async execute({ path }) {
            const page = await getBrainPage(brainUrl, brainTokenRef, path);
            const result = page
              ? { ok: true as const, content: page }
              : { ok: false as const, reason: "page not found or brain unreachable" };
            if (!result.ok) return { unavailable: true, reason: result.reason };
            return { page: result.content };
          },
        });
      }

      if (allowed.has("brain_write")) {
        tools.brain_write = defineTool({
          description:
            "Write an outcome/learning to the knowledge brain (timeline entry or entity-page update). Outcomes only, never chatter; follow the brain's filing + PII rules.",
          inputSchema: z.object({
            path: z
              .string()
              .min(2)
              .max(300)
              .describe("Page path per filing rules, e.g. timeline/2026/07/17-pool-pump-replaced"),
            markdown: z.string().min(10).max(8000),
          }),
          async execute({ path, markdown }) {
            const result = await putBrainPage(brainUrl, brainTokenRef, path, markdown);
            if (!result.ok) return { unavailable: true, reason: result.reason };
            return { written: true, path };
          },
        });
      }

      return tools;
    },
  },
});
