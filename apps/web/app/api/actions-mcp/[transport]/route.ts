import { after } from "next/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/mcp/tokens";
import { createServiceClient } from "@/lib/supabase/server";
import type { ActionsMcpTool } from "@/lib/mcp/actions-tools";
import {
  eveOrigin,
  fleetServiceHeaders,
  readSessionTail,
} from "@/lib/fleet/eve-session";

/**
 * Actions MCP server (fleet spec M5) — the WRITE-capable external surface at
 * /api/actions-mcp/mcp (streamable HTTP). Distinct from the read-only
 * insights server at /api/mcp: every tool here is gated by the api key's
 * `allowed_tools` allow-list (0075; legacy keys have '{}' = nothing), and
 * the token→property binding remains the tenant isolation — propertyId
 * always comes off the verified token, never the caller.
 *
 * Money-moving paths do NOT execute here: named workflows start a durable
 * eve session (task-mode) whose approval-gated tools still park for a
 * human. `get_workflow_status` reads the session's event stream.
 */

type AuthExtra = {
  authInfo?: { extra?: Record<string, unknown> };
};

function authOf(extra: AuthExtra): {
  propertyId: string;
  userId: string;
  allowed: Set<string>;
} {
  const e = extra.authInfo?.extra ?? {};
  const propertyId = e.propertyId;
  const userId = e.userId;
  if (typeof propertyId !== "string" || typeof userId !== "string") {
    throw new Error("unauthorized");
  }
  const allowed = new Set(
    Array.isArray(e.allowedTools) ? (e.allowedTools as string[]) : [],
  );
  return { propertyId, userId, allowed };
}

// Typed against ACTIONS_MCP_TOOLS (lib/mcp/actions-tools.ts) so a new tool
// registration that isn't in the shared constant fails to compile — the
// constant feeds the Fleet UI's key-scope multi-select.
function requireTool(extra: AuthExtra, tool: ActionsMcpTool) {
  const auth = authOf(extra);
  if (!auth.allowed.has(tool)) {
    throw new Error(`This API key is not allowed to call ${tool}.`);
  }
  return auth;
}

/** Named workflows: a typed brief the durable session executes in task
 * style. The bot's own gated tools still require human approval. */
const NAMED_WORKFLOWS: Record<string, { bot: string; brief: (p: Record<string, unknown>) => string }> = {
  extend_stay: {
    bot: "bookings",
    brief: (p) =>
      `Workflow extend_stay: stay ${p.booking_reference}, extend by ${p.extra_nights} night(s). Create a task for the team to confirm the extension with the guest, with every detail given. Do not invent rates or availability.`,
  },
  rebook_guest: {
    bot: "bookings",
    brief: (p) =>
      `Workflow rebook_guest: stay ${p.booking_reference}, requested new start date ${p.new_start_date}. Create a task describing the rebooking request with all details for the team to action${p.refund_original ? ", noting that a refund of the original was requested" : ""}.`,
  },
};

const handler = createMcpHandler((server) => {
  server.tool(
    "list_tasks",
    "List tasks in the key's property (title, status, priority, due date). Optionally filter by status.",
    {
      status: z
        .enum(["todo", "in_progress", "blocked", "done"])
        .optional()
        .describe("Status category (0114): todo = not started, in_progress = active, blocked, done = finished. Each task also returns its list's own status_name."),
      limit: z.number().int().min(1).max(30).default(15),
    },
    async ({ status, limit }, extra) => {
      const { propertyId } = requireTool(extra as AuthExtra, "list_tasks");
      const supabase = createServiceClient();
      let query = supabase
        .from("tasks")
        .select("id, title, status, priority, due_at, status_name:statuses!tasks_status_id_fkey(name)")
        .eq("property_id", propertyId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // Hand-typed embed (Relationships: [] in lib/db/types.ts), as in getTasks.
      const rows = (data ?? []) as unknown as Array<
        Record<string, unknown> & { status_name: { name: string } | null }
      >;
      const tasks = rows.map(({ status_name, ...t }) => ({
        ...t,
        status_name: status_name?.name ?? null,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ count: tasks.length, tasks }) }],
      };
    },
  );

  server.tool(
    "create_task",
    "Create a task in the key's property.",
    {
      title: z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    },
    async ({ title, description, priority }, extra) => {
      const { propertyId, userId } = requireTool(extra as AuthExtra, "create_task");
      const supabase = createServiceClient();
      const { data, error } = await supabase
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
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ created: true, task: data }) }] };
    },
  );

  server.tool(
    "trigger_workflow",
    "Start a named durable workflow (extend_stay, rebook_guest) as an eve agent session. Returns the session id. Money-moving steps inside the workflow still require human approval.",
    {
      workflow: z.enum(["extend_stay", "rebook_guest"]),
      payload: z.record(z.string(), z.unknown()).default({}),
    },
    async ({ workflow, payload }, extra) => {
      const { propertyId, userId } = requireTool(extra as AuthExtra, "trigger_workflow");
      const def = NAMED_WORKFLOWS[workflow];
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secret) throw new Error("server misconfigured");
      const response = await fetch(`${eveOrigin()}/eve/v1/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "x-hotelclaw-property": propertyId,
          "x-hotelclaw-user": userId,
          "x-hotelclaw-bot": def.bot,
        },
        body: JSON.stringify({ message: def.brief(payload) }),
      });
      if (!response.ok) throw new Error(`workflow start failed (${response.status})`);
      const body = (await response.json()) as { sessionId?: string };
      // Record the root session -> tenant binding. Subagent child sessions
      // have no channel auth (eve internal runtime path); their tools
      // recover property scope by looking up the ROOT session id here
      // (apps/agent agent/lib/tenant.ts:resolveTenantCaller). Fail-soft:
      // the workflow itself still runs, only subagent delegation degrades.
      if (body.sessionId) {
        const sessionId = body.sessionId;
        let rowId: string | null = null;
        try {
          const service = createServiceClient();
          const { data: property } = await service
            .from("properties").select("client_id").eq("id", propertyId).single();
          if (property?.client_id) {
            const { data: bot } = await service
              .from("bots").select("id")
              .eq("client_id", property.client_id).eq("bot_id", def.bot)
              .single();
            if (bot) {
              const { data: row } = await service
                .from("bot_chat_sessions")
                .insert({
                  client_id: property.client_id,
                  property_id: propertyId,
                  bot_id: bot.id,
                  channel_id: `workflow:${sessionId}`,
                  eve_session_id: sessionId,
                  last_turn_at: new Date().toISOString(),
                })
                .select("id")
                .single();
              rowId = row?.id ?? null;
            }
          }
        } catch (e) {
          console.warn("[actions-mcp] workflow session record failed", e);
        }
        // Workflow sessions never hold a continuation token otherwise (this
        // route fires and returns) — without this tail read, a workflow
        // parking on a gated tool would be invisible to the Fleet approvals
        // inbox. Fail-soft: the workflow itself is unaffected.
        if (rowId) {
          const recordId = rowId;
          after(async () => {
            try {
              const tail = await readSessionTail(
                sessionId,
                fleetServiceHeaders({ propertyId, userId, botSlug: def.bot }),
                { deadlineMs: 45_000, breakOnSettle: true },
              );
              if (!tail) return;
              const service = createServiceClient();
              await service
                .from("bot_chat_sessions")
                .update({
                  last_turn_at: new Date().toISOString(),
                  status:
                    tail.status === "awaiting_approval" ? "awaiting_approval" : "idle",
                  pending_approval:
                    tail.status === "awaiting_approval"
                      ? {
                          requests: tail.pendingRequests,
                          requestedAt: new Date().toISOString(),
                          channelId: `workflow:${sessionId}`,
                        }
                      : null,
                })
                .eq("id", recordId);
            } catch (e) {
              console.warn("[actions-mcp] workflow park stamp failed", e);
            }
          });
        }
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ started: true, workflow, session_id: body.sessionId }),
        }],
      };
    },
  );

  server.tool(
    "get_workflow_status",
    "Read a workflow session's status: completed/awaiting_approval/failed/running plus the latest agent message.",
    { session_id: z.string().min(4).max(80) },
    async ({ session_id }, extra) => {
      const { propertyId, userId } = requireTool(extra as AuthExtra, "get_workflow_status");
      // Read the replayed history briefly, then classify from the tail
      // (shared reader — deadline-raced because the stream never closes).
      const tail = await readSessionTail(
        session_id,
        fleetServiceHeaders({ propertyId, userId }),
      );
      if (!tail) throw new Error("session not found or not readable");
      const status = tail.status;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            session_id,
            status,
            last_message: tail.lastMessage.slice(0, 1500),
            pending_approval: tail.pendingRequests.length ? tail.pendingRequests : null,
            note: status === "awaiting_approval"
              ? "A human must approve in-app (Fleet → Approvals, or message the bot 'approve' in its channel)."
              : undefined,
          }),
        }],
      };
    },
  );
}, undefined, { basePath: "/api/actions-mcp" });

const authedHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    const verified = await verifyApiToken(bearerToken);
    if (!verified) return undefined;
    return {
      token: bearerToken!,
      clientId: verified.tokenId,
      scopes: ["actions"],
      extra: {
        propertyId: verified.propertyId,
        userId: verified.createdBy,
        allowedTools: verified.allowedTools,
      },
    };
  },
  { required: true },
);

export {
  authedHandler as GET,
  authedHandler as POST,
  authedHandler as DELETE,
};
