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
        "List open tasks (not done) in this property. Use when the user asks about workload, what's pending, or who's working on what.",
      inputSchema: z.object({
        status: z
          .enum(["todo", "in_progress", "blocked"])
          .optional()
          .describe("Filter to a single status. Omit to return all open."),
        assignee_name: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring match on the assignee's full name.",
          ),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ status, assignee_name, limit }) => {
        let query = supabase
          .from("tasks")
          .select(
            "id, title, status, priority, due_at, assignee:profiles!tasks_assignee_id_fkey(full_name)",
          )
          .eq("property_id", propertyId)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (status) query = query.eq("status", status);
        else query = query.neq("status", "done");
        const { data, error } = await query;
        if (error) return { error: error.message };
        let rows = (data ?? []).map((t) => ({
          title: t.title,
          status: STATUS_LABELS[t.status] ?? t.status,
          priority: t.priority,
          due: t.due_at,
          assignee:
            (t.assignee as { full_name?: string | null } | null)?.full_name ??
            null,
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
        "Full-text search over the property's documents. Returns title, a short preview, and the last-updated date for each match. Use when the user asks 'what do our docs say about X' or wants to find a specific doc.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("Free-text search query. Supports quoted phrases."),
        limit: z.number().int().min(1).max(10).default(5),
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
        "List meetings scheduled in this property in the next N days (default 7). Use when the user asks about the week, what's next, or upcoming calls.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(60).default(7),
        limit: z.number().int().min(1).max(20).default(10),
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
