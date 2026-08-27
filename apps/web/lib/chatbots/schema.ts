import { z } from "zod";

/**
 * The chatbot definition JSON stored in `chatbots.config` — one versioned
 * shape shared by the builder, the guest runtime (tool registry reads
 * `actions`), AI generation, and the test console. Owning this schema keeps
 * persisted bots stable across dependency upgrades; bump `version` and
 * migrate forward if the shape ever has to change (same discipline as
 * lib/forms/schema.ts).
 */

export const CHATBOT_MODEL_TIERS = ["standard", "advanced"] as const;
export type ChatbotModelTier = (typeof CHATBOT_MODEL_TIERS)[number];

/** Model ids per tier — standard for FAQ/RAG bots, advanced for action-heavy. */
export const CHATBOT_TIER_MODELS: Record<ChatbotModelTier, string> = {
  standard: "claude-haiku-4-5-20251001",
  advanced: "claude-sonnet-5",
};

export const TICKET_KINDS = ["order", "request", "maintenance"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

/** A detail the bot must collect before creating a ticket (room, items…). */
export const TicketFieldZod = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
});

/**
 * Every action carries `whenToUse` — natural-language trigger guidance
 * appended to the tool description so the model knows when to reach for it
 * (the Chatbase mechanism; no deterministic rules).
 */
const actionBase = {
  enabled: z.boolean(),
  whenToUse: z.string().optional(),
};

export const ChatbotActionZod = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("answer_from_knowledge"),
    ...actionBase,
  }),
  z.object({
    type: z.literal("create_ticket"),
    ...actionBase,
    config: z.object({
      kind: z.enum(TICKET_KINDS),
      /** Space the task lands in (picker in the builder). */
      spaceId: z.string().optional(),
      projectId: z.string().optional(),
      assigneeId: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      /** Stream channel that gets the ticket card (e.g. #room-service). */
      notifyChannelId: z.string().optional(),
      /** Details the bot collects from the guest before filing. */
      fields: z.array(TicketFieldZod).default([]),
    }),
  }),
  z.object({
    type: z.literal("collect_guest_info"),
    ...actionBase,
    config: z.object({
      name: z.boolean().default(true),
      email: z.boolean().default(false),
      phone: z.boolean().default(false),
      room: z.boolean().default(false),
    }),
  }),
  z.object({
    type: z.literal("escalate_to_human"),
    ...actionBase,
    config: z.object({
      /** Stream channel where escalation cards land. */
      channelId: z.string().optional(),
      notifyRoles: z
        .array(z.enum(["owner", "manager", "staff"]))
        .default(["owner", "manager"]),
    }),
  }),
  z.object({
    type: z.literal("book_service"),
    ...actionBase,
    config: z.object({
      /** Bookable services this bot may offer. Empty = every active service. */
      serviceIds: z.array(z.string()).default([]),
      /** Confirm instantly vs hold as pending for staff review. */
      autoConfirm: z.boolean().default(true),
      /** Stream channel that gets a card for each new booking. */
      notifyChannelId: z.string().optional(),
    }),
  }),
]);

export type ChatbotAction = z.infer<typeof ChatbotActionZod>;
export type ChatbotActionType = ChatbotAction["type"];

export const ChatbotAppearanceZod = z.object({
  /** Name guests see in the chat header (often differs from internal name). */
  displayName: z.string().min(1),
  avatarEmoji: z.string().default("🛎️"),
  /** Accent override on the guest page; falls back to the warm default. */
  brandColor: z.string().optional(),
  theme: z.enum(["warm", "app"]).default("warm"),
});

export const DEFAULT_FALLBACK_MESSAGE =
  "I'm not able to help with that — let me get a member of our team.";
export const DEFAULT_HANDOFF_MESSAGE =
  "I'm connecting you with our team — someone will reply right here.";

export const ChatbotGuardrailsZod = z.object({
  /** Strict mode: only answer from trained knowledge, never general takes. */
  onlyFromSources: z.boolean().default(false),
  /** Shown when the bot can't help / budget exhausted. */
  fallbackMessage: z.string().default(DEFAULT_FALLBACK_MESSAGE),
  /** Shown when handing off to a human. */
  handoffMessage: z.string().default(DEFAULT_HANDOFF_MESSAGE),
});

export const ChatbotConfigZod = z.object({
  version: z.literal(1),
  /** Persona/system instructions — the heart of the bot. */
  instructions: z.string().default(""),
  modelTier: z.enum(CHATBOT_MODEL_TIERS).default("standard"),
  greeting: z.string().default("Hi! How can I help you today?"),
  suggestedQuestions: z.array(z.string()).max(4).default([]),
  appearance: ChatbotAppearanceZod.default({
    displayName: "Concierge",
    avatarEmoji: "🛎️",
    theme: "warm",
  }),
  guardrails: ChatbotGuardrailsZod.default({
    onlyFromSources: false,
    fallbackMessage: DEFAULT_FALLBACK_MESSAGE,
    handoffMessage: DEFAULT_HANDOFF_MESSAGE,
  }),
  actions: z.array(ChatbotActionZod).default([]),
  /** Default team (space id) that tickets from this bot land on when the
   *  create_ticket action doesn't set its own. Bare tickets (no team) still
   *  get org-chart-routed by triage; this is the deterministic fallback. */
  defaultTeamId: z.string().optional(),
});

export type ChatbotConfig = z.infer<typeof ChatbotConfigZod>;
export type ChatbotAppearance = z.infer<typeof ChatbotAppearanceZod>;
export type ChatbotGuardrails = z.infer<typeof ChatbotGuardrailsZod>;

export const EMPTY_CHATBOT_CONFIG: ChatbotConfig = ChatbotConfigZod.parse({
  version: 1,
});

export function parseChatbotConfig(raw: unknown): ChatbotConfig {
  const parsed = ChatbotConfigZod.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_CHATBOT_CONFIG;
}

export function newTicketFieldId(): string {
  return `tf_${crypto.randomUUID().slice(0, 8)}`;
}

/** Display metadata for the builder's actions panel. */
export const ACTION_TYPE_META: Record<
  ChatbotActionType,
  { label: string; description: string }
> = {
  answer_from_knowledge: {
    label: "Answer from knowledge",
    description: "Search this bot's trained sources to answer guest questions",
  },
  create_ticket: {
    label: "Create a ticket",
    description:
      "Turn an order or request into a task for your team, with a channel ping",
  },
  collect_guest_info: {
    label: "Collect guest info",
    description: "Ask for name, room, or contact details when relevant",
  },
  escalate_to_human: {
    label: "Escalate to a human",
    description: "Hand the conversation to your team and notify them",
  },
  book_service: {
    label: "Take bookings",
    description:
      "Check real availability and book tables, spa slots, or tours from the Bookings feature",
  },
};

export const CHATBOT_TEMPLATES = [
  "front_desk",
  "room_service",
  "restaurant",
  "custom",
] as const;
export type ChatbotTemplate = (typeof CHATBOT_TEMPLATES)[number];

/** Row shape used across list/builder/server code (subset of the table). */
export type ChatbotRow = {
  id: string;
  property_id: string;
  name: string;
  public_slug: string;
  template: ChatbotTemplate;
  config: ChatbotConfig;
  status: "draft" | "published" | "paused";
  daily_message_cap: number;
  session_message_cap: number;
  allowed_domains: string[];
  twilio_number: string | null;
  last_trained_at: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
