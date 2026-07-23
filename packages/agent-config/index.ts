import { z } from "zod";

/**
 * Internal AI agents — versioned config stored in `agents.config` (migration
 * 0073), same discipline as lib/chatbots/schema.ts / lib/forms/schema.ts.
 *
 * IMPORTANT: this file is imported by BOTH apps/web (builder UI, actions,
 * routes) and apps/agent (the eve runtime resolves instructions/tools/skills
 * per session from these rows). It must stay dependency-free apart from zod —
 * no `ai`, no `server-only`, no app imports — because apps/agent bundles it
 * into the eve worker where apps/web's AI SDK v6 modules must never load.
 */

export const AGENT_SKILL_LIMIT = 12;
export const AGENT_RESOURCE_LIMIT = 20;

/** SKILL.md-format skill: markdown procedure the model loads on demand.
 * The `description` is the routing hint eve advertises to the model. */
export const AgentSkillZod = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase slug"),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  markdown: z.string().min(1).max(20_000),
});
export type AgentSkill = z.infer<typeof AgentSkillZod>;

export const AgentConfigZod = z.object({
  version: z.literal(1),
  /** One-liner shown on the gallery card and to teammates. */
  description: z.string().max(300).default(""),
  avatarEmoji: z.string().max(8).default("🤖"),
  /** The agent's system prompt. Shown verbatim in the editor — transparency
   * means what you read here is exactly what the model gets. */
  instructions: z.string().max(12_000).default(""),
  modelTier: z.enum(["standard", "advanced"]).default("standard"),
  /** Tool grants: ids from AGENT_TOOL_CATALOG. The eve runtime builds only
   * these tools for the session; everything else simply doesn't exist. */
  tools: z.array(z.string().max(64)).max(64).default([]),
  skills: z.array(AgentSkillZod).max(AGENT_SKILL_LIMIT).default([]),
  /** Attached documents the agent may read in full via `read_resource`. */
  resources: z
    .object({
      documentIds: z.array(z.string().uuid()).max(AGENT_RESOURCE_LIMIT).default([]),
    })
    .default({ documentIds: [] }),
  starterPrompts: z.array(z.string().max(200)).max(4).default([]),
});
export type AgentConfig = z.infer<typeof AgentConfigZod>;

export const EMPTY_AGENT_CONFIG: AgentConfig = AgentConfigZod.parse({
  version: 1,
});

export function parseAgentConfig(raw: unknown): AgentConfig {
  const result = AgentConfigZod.safeParse(raw);
  return result.success ? result.data : EMPTY_AGENT_CONFIG;
}

/** Model tier → Anthropic model id. Mirrors CHATBOT_TIER_MODELS so the two
 * builders describe cost the same way. */
export const AGENT_TIER_MODELS: Record<AgentConfig["modelTier"], string> = {
  standard: "claude-haiku-4-5-20251001",
  advanced: "claude-sonnet-4-6",
};

/**
 * The tool catalog — every capability an agent can be granted, with the
 * human-readable metadata the Agents UI shows. The EXECUTORS live in
 * apps/agent/agent/tools/catalog.ts and must cover exactly these ids (the
 * two files cross-reference each other; keep them in sync).
 */
export type AgentToolMeta = {
  id: string;
  label: string;
  /** What the UI tells staff this grant allows. */
  summary: string;
  category: "read" | "write";
};

export const AGENT_TOOL_CATALOG: AgentToolMeta[] = [
  {
    id: "list_open_tasks",
    label: "Read tasks",
    summary: "List open tasks (title, status, priority, assignee).",
    category: "read",
  },
  {
    id: "search_tasks",
    label: "Search tasks",
    summary:
      "Full-text search over all tasks — including done — by title and description.",
    category: "read",
  },
  {
    id: "create_task",
    label: "Create tasks",
    summary: "File new tasks into the property's board.",
    category: "write",
  },
  {
    id: "update_task",
    label: "Update tasks",
    summary:
      "Change a task's status, priority, due date, assignee, title, or description.",
    category: "write",
  },
  {
    id: "create_document",
    label: "Create documents",
    summary: "Write new documents (SOPs, runbooks, notes) with real content.",
    category: "write",
  },
  {
    id: "update_document",
    label: "Edit documents",
    summary: "Replace or append content in existing documents.",
    category: "write",
  },
  {
    id: "archive_document",
    label: "Archive documents (approval-gated)",
    summary:
      "Archive a document tree — every call parks for human approval first.",
    category: "write",
  },
  {
    id: "search_documents",
    label: "Search documents",
    summary:
      "Full-text search over the property's documents (including extracted text of file attachments).",
    category: "read",
  },
  {
    id: "list_documents",
    label: "List documents",
    summary: "List the property's documents by title, most recently edited first.",
    category: "read",
  },
  {
    id: "read_document",
    label: "Read documents",
    summary: "Read any document's full body (faithful HTML incl. tables/lists).",
    category: "read",
  },
  {
    id: "list_upcoming_meetings",
    label: "Read upcoming meetings",
    summary: "List meetings scheduled in the coming days.",
    category: "read",
  },
  {
    id: "list_meetings",
    label: "Read meetings (past + future)",
    summary: "List meetings in any window — past history included.",
    category: "read",
  },
  {
    id: "list_today_bookings",
    label: "Read today's bookings",
    summary: "List today's bookings across services (time, party, status).",
    category: "read",
  },
  {
    id: "list_bookings",
    label: "Read bookings (any window)",
    summary: "List bookings across services for a past/future window.",
    category: "read",
  },
  {
    id: "search_chat_messages",
    label: "Search chat history",
    summary:
      "Search past messages in channels the requesting person belongs to.",
    category: "read",
  },
  {
    id: "list_forms",
    label: "Read forms",
    summary: "List the property's forms and their status/response counts.",
    category: "read",
  },
  {
    id: "get_form_response_summaries",
    label: "Read form responses",
    summary:
      "Aggregated response summaries for a form (choice counts, recent text answers).",
    category: "read",
  },
  {
    id: "guest_conversation_insights",
    label: "Read guest chatbot activity",
    summary:
      "What guests asked the property's chatbots: topics, sentiment, escalations, outcomes.",
    category: "read",
  },
  {
    id: "get_insight_brief",
    label: "Read the intelligence brief",
    summary:
      "The cached Insights brief cards. Only answers owners/managers.",
    category: "read",
  },
  {
    id: "get_weekly_report",
    label: "Read weekly reports",
    summary:
      "The cached weekly management/staff report. Only answers owners/managers.",
    category: "read",
  },
  {
    id: "list_handovers",
    label: "Read handovers",
    summary:
      "Recent published shift handovers. Only answers owners/managers.",
    category: "read",
  },
  {
    id: "start_background_job",
    label: "Run background jobs",
    summary:
      "Hand heavy, long-running work to a detached session that posts results back to the channel when done.",
    category: "write",
  },
  {
    id: "get_org_chart",
    label: "Read org chart",
    summary: "Teams, reporting lines, and who owns what.",
    category: "read",
  },
  {
    id: "read_resource",
    label: "Read attached resources",
    summary: "Read the full text of documents attached to this agent.",
    category: "read",
  },
  {
    id: "brain_search",
    label: "Search the knowledge brain",
    summary:
      "Search the property's institutional memory (past incidents, suppliers, guest history).",
    category: "read",
  },
  {
    id: "brain_think",
    label: "Ask the knowledge brain",
    summary:
      "Synthesized answers with citations for hard questions spanning many brain pages.",
    category: "read",
  },
  {
    id: "brain_get",
    label: "Read brain pages",
    summary: "Read one full knowledge-brain page by slug.",
    category: "read",
  },
  {
    id: "brain_list",
    label: "List brain pages",
    summary: "List knowledge-brain pages (optionally under a slug prefix).",
    category: "read",
  },
  {
    id: "brain_capture",
    label: "Capture to the knowledge brain",
    summary:
      "Record durable observations to the property's shared brain timeline.",
    category: "write",
  },
  {
    id: "delete_task",
    label: "Delete tasks (approval-gated)",
    summary: "Permanently delete a task — every call parks for human approval first.",
    category: "write",
  },
  {
    id: "escalate_task",
    label: "Escalate tasks",
    summary:
      "Flag a task to its team lead or a manager with a notification and a note.",
    category: "write",
  },
  {
    id: "create_project",
    label: "Create projects",
    summary: "Create a new project, optionally inside a team.",
    category: "write",
  },
  {
    id: "schedule_meeting",
    label: "Schedule meetings",
    summary: "Put a meeting on the calendar with a title, time, and location.",
    category: "write",
  },
  {
    id: "update_meeting",
    label: "Update meetings",
    summary: "Reschedule or retitle an upcoming meeting.",
    category: "write",
  },
  {
    id: "cancel_meeting",
    label: "Cancel meetings",
    summary: "Cancel (delete) an upcoming meeting.",
    category: "write",
  },
  {
    id: "create_booking",
    label: "Create bookings",
    summary:
      "Book a guest into a bookable service through the real availability engine.",
    category: "write",
  },
  {
    id: "update_booking_status",
    label: "Update booking status",
    summary:
      "Confirm, seat, complete, no-show, or cancel a booking by reference.",
    category: "write",
  },
  {
    id: "read_sheet",
    label: "Read spreadsheets",
    summary: "Read a spreadsheet document's cells as an A1 grid.",
    category: "read",
  },
  {
    id: "update_sheet_cells",
    label: "Edit spreadsheets",
    summary: "Write values into spreadsheet cells (A1 references), live.",
    category: "write",
  },
  {
    id: "create_form",
    label: "Create forms",
    summary: "Build a new form with typed fields, ready to publish.",
    category: "write",
  },
  {
    id: "set_form_status",
    label: "Publish/close forms",
    summary: "Move a form between draft, published, and closed.",
    category: "write",
  },
  {
    id: "share_form_to_channel",
    label: "Share forms to chat",
    summary: "Post a published form into this channel as a fill-in-place card.",
    category: "write",
  },
  {
    id: "send_notification",
    label: "Send notifications",
    summary: "Send an in-app notification to a named person or a whole team.",
    category: "write",
  },
  {
    id: "post_to_channel",
    label: "Post to channels",
    summary: "Post a message to another channel in this property as the bot.",
    category: "write",
  },
  {
    id: "list_workflows",
    label: "List workflows",
    summary: "List the property's workflow automations and their triggers.",
    category: "read",
  },
  {
    id: "trigger_workflow",
    label: "Trigger workflows",
    summary: "Run a manually-triggerable workflow by name.",
    category: "write",
  },
  {
    id: "restore_document_revision",
    label: "Restore document revisions",
    summary:
      "Undo an AI replace by restoring a document's stashed pre-replace revision.",
    category: "write",
  },
];

export const AGENT_TOOL_IDS = new Set(AGENT_TOOL_CATALOG.map((t) => t.id));

export type AgentRow = {
  id: string;
  property_id: string;
  name: string;
  config: AgentConfig;
  status: "active" | "paused";
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
