import "server-only";
/**
 * Task detail bot — Tier 1 in-app AI scoped to a single task.
 *
 * Lives inside the task detail panel. User asks things like:
 *   - "What does this task involve?"
 *   - "Who's blocked on this?"
 *   - "Summarize the description into 3 bullet points"
 *   - "Suggest a clearer title"
 *   - "What other tasks are related?"
 *
 * Persona + task-scoped tools (get_task_details, get_related_tasks,
 * get_subtasks) plus the runtime's shared gbrain + delegate tools.
 *
 * Architecture: this module is just a thin descriptor — it knows the
 * persona and which tools to expose. Actual generation goes through
 * `runBot()` so it inherits all the cross-bot guarantees (gbrain wiring,
 * delegate-to-OpenClaw, consistent model settings).
 */
import { runBot, tool, z, type ModelMessage, type ToolSet } from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/**
 * Tools the task bot can call. Property + task scoped — the API route
 * builds these with the resolved propertyId + taskId before calling
 * `runTaskBot()`.
 */
function buildTaskScopedTools(propertyId: string, taskId: string): ToolSet {
  const supabase = createServiceClient();

  return {
    get_task_details: tool({
      description:
        "Fetch the full task you're scoped to — title, description, status, priority, due date, assignee, labels, parent task, project. Use this at the start of any conversation to ground yourself in what the user is looking at. The user already sees the task on screen, so don't dump everything back — pull what you need to answer.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("tasks")
          .select(
            "id, title, description, status, priority, due_at, assignee_id, parent_id, labels, project_name, created_at, updated_at",
          )
          .eq("id", taskId)
          .eq("property_id", propertyId)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "task not found" };

        // Resolve assignee name (same two-query pattern as lib/ai/tools.ts —
        // tasks.assignee_id → auth.users, no direct FK to profiles).
        let assignee: string | null = null;
        if (data.assignee_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", data.assignee_id)
            .maybeSingle();
          assignee = profile?.full_name ?? null;
        }

        return {
          title: data.title,
          description: data.description,
          status: STATUS_LABELS[data.status] ?? data.status,
          priority: data.priority,
          due: data.due_at,
          assignee,
          labels: data.labels,
          project: data.project_name,
          parent_id: data.parent_id,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
      },
    }),

    get_subtasks: tool({
      description:
        "Fetch sub-tasks of the current task (tasks whose parent_id matches). Returns count + titles + statuses. Use when the user asks 'what's left on this', 'what's blocked under this', or wants a status check across children.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max subtasks to return."),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await supabase
          .from("tasks")
          .select("id, title, status, priority, assignee_id, due_at")
          .eq("property_id", propertyId)
          .eq("parent_id", taskId)
          .order("position", { ascending: true })
          .limit(limit);
        if (error) return { error: error.message };
        return {
          count: (data ?? []).length,
          subtasks: (data ?? []).map((t) => ({
            title: t.title,
            status: STATUS_LABELS[t.status] ?? t.status,
            priority: t.priority,
            due: t.due_at,
          })),
        };
      },
    }),

    get_related_tasks: tool({
      description:
        "Fetch tasks linked to this task via task_relations (manually marked 'related' by users). Use when the user asks about dependencies, related work, or wants context from connected tasks.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ limit }) => {
        // task_relations has both directions (task_id and related_task_id);
        // pull both, dedupe.
        const [out, inn] = await Promise.all([
          supabase
            .from("task_relations")
            .select("related_task_id")
            .eq("task_id", taskId)
            .limit(limit),
          supabase
            .from("task_relations")
            .select("task_id")
            .eq("related_task_id", taskId)
            .limit(limit),
        ]);
        const relatedIds = new Set<string>();
        for (const r of out.data ?? []) {
          if (r.related_task_id) relatedIds.add(r.related_task_id);
        }
        for (const r of inn.data ?? []) {
          if (r.task_id) relatedIds.add(r.task_id);
        }
        if (relatedIds.size === 0) return { count: 0, tasks: [] };
        const { data, error } = await supabase
          .from("tasks")
          .select("id, title, status, priority, due_at")
          .in("id", [...relatedIds])
          .eq("property_id", propertyId)
          .limit(limit);
        if (error) return { error: error.message };
        return {
          count: (data ?? []).length,
          tasks: (data ?? []).map((t) => ({
            title: t.title,
            status: STATUS_LABELS[t.status] ?? t.status,
            priority: t.priority,
            due: t.due_at,
          })),
        };
      },
    }),
  };
}

const TASK_BOT_PERSONA = [
  "You are the task assistant for Hotelclaw — a focused AI scoped to a single task the user is looking at right now.",
  "Your goal: help the user understand what this task is, what's left, what's blocking it, and what to do next. You see the same task they do (use `get_task_details` to pull the live state).",
  "Stay tightly scoped to THIS task. If they ask about other tasks, use `get_related_tasks` or `get_subtasks` — don't make up information about tasks you can't see.",
].join(" ");

export async function runTaskBot(opts: {
  propertyId: string;
  userId: string;
  taskId: string;
  /** Conversation so far (user/assistant alternation). The bot generates the next assistant turn. */
  messages: ModelMessage[];
}): Promise<{ text: string }> {
  const result = await runBot({
    persona: TASK_BOT_PERSONA,
    activationReason: "mention", // user clicked / typed → direct invocation
    scopedTools: buildTaskScopedTools(opts.propertyId, opts.taskId),
    messages: opts.messages,
    scope: {
      propertyId: opts.propertyId,
      userId: opts.userId,
      surface: "task",
    },
  });
  return { text: result.text };
}
