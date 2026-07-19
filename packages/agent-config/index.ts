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
  tools: z.array(z.string().max(64)).max(32).default([]),
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
    id: "create_task",
    label: "Create tasks",
    summary: "File new tasks into the property's board.",
    category: "write",
  },
  {
    id: "search_documents",
    label: "Search documents",
    summary: "Full-text search over the property's documents.",
    category: "read",
  },
  {
    id: "list_upcoming_meetings",
    label: "Read meetings",
    summary: "List meetings scheduled in the coming days.",
    category: "read",
  },
  {
    id: "list_today_bookings",
    label: "Read bookings",
    summary: "List today's bookings across services (time, party, status).",
    category: "read",
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
    id: "brain_capture",
    label: "Capture to the knowledge brain",
    summary:
      "Record durable observations to the property's shared brain timeline.",
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
