import "server-only";
/**
 * Shared AI tools for both the Stream Chat bot and the Liveblocks comment bot.
 *
 * Tools are scoped to a single property — the caller passes `propertyId`
 * (derived from the channel or room id) and the returned tool set queries
 * only that tenant's data. All reads go through the service-role Supabase
 * client because the bot runs without a user session; the property scoping
 * happens explicitly in each query, not via RLS.
 *
 * Adding a tool:
 *   1. Add a `tool({ description, inputSchema, execute })` entry below.
 *   2. Keep descriptions imperative and specific — the model picks tools by
 *      reading these and matching them to the user's question.
 *   3. Return small, plain-JSON shapes; the model serializes them back into
 *      its reply so smaller payloads = cheaper + less hallucination surface.
 */
import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export function buildPropertyTools(propertyId: string) {
  const supabase = createServiceClient();

  return {
    list_open_tasks: tool({
      description:
        "List open tasks (not done) in this property. Use when the user asks about workload, what's pending, who's working on what, or anything blocked. Returns `count` (total open matching the filter) and `tasks` (the first N). If `count` exceeds `tasks.length`, mention to the user that more exist and they can ask for specifics. If `tasks` is empty, say so plainly — don't fabricate.",
      inputSchema: z.object({
        status: z
          .enum(["todo", "in_progress", "blocked"])
          .optional()
          .describe(
            "Filter to a single status. Omit to return all open statuses (todo + in_progress + blocked).",
          ),
        assignee_name: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring match on the assignee's full name. Use when the user asks about a specific person's workload.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Max tasks to return. Default 10 is right for most asks."),
      }),
      execute: async ({ status, assignee_name, limit }) => {
        // Two-query pattern: PostgREST can't auto-embed the assignee profile
        // because tasks.assignee_id has its FK pointing at auth.users(id),
        // not public.profiles(id). The implicit relationship works in the
        // app (via separate joins) but the embed syntax requires a direct
        // FK between the two tables and there isn't one. Pull tasks first,
        // then resolve assignee names in a second batched query.
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

        // Resolve assignee names with one batched profile lookup.
        const assigneeIds = Array.from(
          new Set(
            (tasks ?? [])
              .map((t) => t.assignee_id)
              .filter((id): id is string => !!id),
          ),
        );
        let nameById = new Map<string, string>();
        if (assigneeIds.length > 0) {
          const { data: profiles, error: profErr } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", assigneeIds);
          if (!profErr) {
            for (const p of profiles ?? []) {
              if (p.full_name) nameById.set(p.id, p.full_name);
            }
          }
        }

        let rows = (tasks ?? []).map((t) => ({
          title: t.title,
          status: STATUS_LABELS[t.status] ?? t.status,
          priority: t.priority,
          due: t.due_at,
          assignee: t.assignee_id ? nameById.get(t.assignee_id) ?? null : null,
        }));
        if (assignee_name) {
          const needle = assignee_name.toLowerCase();
          rows = rows.filter((r) =>
            (r.assignee ?? "").toLowerCase().includes(needle),
          );
        }
        return { count: rows.length, tasks: rows };
      },
    }),

    search_documents: tool({
      description:
        "Full-text search over the property's documents. Returns `count` and `results` (title + ~240-char preview + last-updated date). Use when the user asks 'what do our docs say about X', 'find the doc about Y', or wants policy/SOP information. The `preview` is a snippet, not the full doc — synthesize a brief answer from it and mention the doc title so the user can open it. If `count` is 0, say no matching docs exist; don't invent content.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Free-text search query. Supports quoted phrases (e.g. \"cancellation policy\") and OR/NOT keywords (websearch syntax).",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Max matches to return. Default 5 is right for most asks."),
      }),
      execute: async ({ query, limit }) => {
        const { data, error } = await supabase.rpc(
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
            (r: {
              id: string;
              title: string;
              preview: string;
              updated_at: string;
            }) => ({
              title: r.title,
              preview: r.preview,
              updated_at: r.updated_at,
            }),
          ),
        };
      },
    }),

    list_upcoming_meetings: tool({
      description:
        "List meetings scheduled in this property in the next N days. Returns `count` and `meetings` (title, start, end, location). Use when the user asks about 'this week', 'what's next', upcoming calls, or specific scheduled meetings. Times are ISO 8601 — convert to the user's natural phrasing in the reply. If `count` is 0, say nothing's scheduled in that window.",
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(7)
          .describe(
            "How many days forward to look. Default 7 (this week). Use 1 for 'today', 30 for 'this month'.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Max meetings to return."),
      }),
      execute: async ({ days, limit }) => {
        const now = new Date();
        const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const { data, error } = await supabase
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
            title: m.title,
            start: m.scheduled_start,
            end: m.scheduled_end,
            location: m.location,
          })),
        };
      },
    }),
  };
}

export type PropertyTools = ReturnType<typeof buildPropertyTools>;
