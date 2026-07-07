import "server-only";
/**
 * Tool registry for guest-facing chatbots.
 *
 * Structurally restricted: a guest bot gets ONLY the tools its saved config
 * enables — no gbrain MCP, no delegate_to_openclaw, no property-wide tools.
 * Every tool closure captures the tenant scope server-side; the model never
 * supplies property/chatbot/conversation ids. Each action's user-written
 * `whenToUse` text is appended to the tool description (the Chatbase
 * trigger mechanism).
 *
 * In sandbox mode (the builder's test console) the side-effecting tools
 * return `{ simulated: true, … }` instead of writing — knowledge search
 * stays live so staff can verify their sources actually answer.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { getBotUserId } from "@/lib/stream/ai-adapter";
import { createNotifications } from "@/lib/notifications/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import { searchChatbotKnowledge } from "@/lib/chatbots/retrieval";
import {
  executeCustomAction,
  type CustomActionRow,
} from "@/lib/chatbots/custom-actions";
import {
  createBookingChecked,
  formatSlotForGuest,
  getServiceAvailability,
  todayInTz,
  type BookableServiceRow,
} from "@/lib/bookings/availability";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import {
  coerceBookingAnswers,
  describeBookingQuestions,
  loadBookingForm,
  recordBookingFormResponse,
  summarizeAnswers,
  validateBookingAnswers,
  type BookingFormPayload,
} from "@/lib/bookings/booking-form";
import type { FormAnswers } from "@/lib/forms/schema";
import type { ChatbotAction, ChatbotConfig } from "@/lib/chatbots/schema";

export type GuestBotScope = {
  propertyId: string;
  chatbotId: string;
  chatbotName: string;
  conversationId: string;
  /** Test console — side-effecting tools simulate instead of writing. */
  sandbox: boolean;
};

type ConversationGuest = {
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  room_number: string | null;
};

async function loadGuest(scope: GuestBotScope): Promise<ConversationGuest> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("chatbot_conversations")
    .select("guest_name, guest_email, guest_phone, room_number")
    .eq("id", scope.conversationId)
    .eq("property_id", scope.propertyId)
    .maybeSingle();
  return (
    data ?? {
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      room_number: null,
    }
  );
}

function withWhenToUse(base: string, whenToUse?: string): string {
  return whenToUse ? `${base}\nWhen to use: ${whenToUse}` : base;
}

/** Post to a staff Stream channel as the house bot user. Fail-soft. */
async function postToStaffChannel(streamChannelId: string, text: string) {
  try {
    const stream = getStreamServer();
    const channel = stream.channel("team", streamChannelId);
    await channel.sendMessage({
      text,
      user_id: getBotUserId(),
      ai_generated: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0]);
  } catch (err) {
    console.error("[guest-bot] staff channel post failed", err);
  }
}

function buildSearchKnowledgeTool(
  scope: GuestBotScope,
  action: Extract<ChatbotAction, { type: "answer_from_knowledge" }>,
) {
  return tool({
    description: withWhenToUse(
      "Search this property's knowledge base for facts to answer the guest's question — menus, hours, policies, amenities, prices. Always search before answering questions about specifics.",
      action.whenToUse,
    ),
    inputSchema: z.object({
      query: z.string().describe("Search terms — the guest's question, rephrased as keywords"),
    }),
    execute: async ({ query }) => {
      const hits = await searchChatbotKnowledge({
        chatbotId: scope.chatbotId,
        query,
      });
      if (hits.length === 0) {
        return { results: [], note: "No matches in the knowledge base." };
      }
      return {
        results: hits.map((h) => ({ source: h.sourceTitle, content: h.content })),
      };
    },
  });
}

function buildSaveGuestDetailsTool(
  scope: GuestBotScope,
  action: Extract<ChatbotAction, { type: "collect_guest_info" }>,
) {
  const wanted = [
    action.config.name && "name",
    action.config.email && "email",
    action.config.phone && "phone",
    action.config.room && "room_number",
  ]
    .filter(Boolean)
    .join(", ");

  // Only the configured fields appear in the schema — a disabled field
  // isn't even representable to the model.
  const shape: Record<string, z.ZodTypeAny> = {};
  if (action.config.name) shape.name = z.string().optional();
  if (action.config.email) shape.email = z.string().optional();
  if (action.config.phone) shape.phone = z.string().optional();
  if (action.config.room) shape.room_number = z.string().optional();

  return tool({
    description: withWhenToUse(
      `Save details the guest shares (${wanted || "name"}) so staff can follow up. Ask conversationally — never demand everything at once. Call this as soon as the guest provides any of these details.`,
      action.whenToUse,
    ),
    inputSchema: z.object(shape) as z.ZodType<{
      name?: string;
      email?: string;
      phone?: string;
      room_number?: string;
    }>,
    execute: async (input) => {
      const patch: {
        guest_name?: string;
        guest_email?: string;
        guest_phone?: string;
        room_number?: string;
      } = {};
      if (action.config.name && input.name?.trim()) patch.guest_name = input.name.trim();
      if (action.config.email && input.email?.trim()) patch.guest_email = input.email.trim();
      if (action.config.phone && input.phone?.trim()) patch.guest_phone = input.phone.trim();
      if (action.config.room && input.room_number?.trim()) {
        patch.room_number = input.room_number.trim();
      }
      if (Object.keys(patch).length === 0) return { saved: false };

      const supabase = createServiceClient();
      await supabase
        .from("chatbot_conversations")
        .update(patch)
        .eq("id", scope.conversationId)
        .eq("property_id", scope.propertyId);

      if (!scope.sandbox && (patch.guest_email || patch.guest_phone)) {
        const guest = await loadGuest(scope);
        await emitWorkflowEvent({
          propertyId: scope.propertyId,
          source: "chatbot",
          eventType: "chatbot.lead_captured",
          entityId: scope.conversationId,
          entityKind: "chatbot_conversation",
          payload: {
            chatbot_id: scope.chatbotId,
            chatbot_name: scope.chatbotName,
            conversation_id: scope.conversationId,
            guest_name: guest.guest_name,
            room_number: guest.room_number,
            guest_email: guest.guest_email,
            guest_phone: guest.guest_phone,
          },
        });
      }
      return { saved: true, fields: Object.keys(patch) };
    },
  });
}

function buildCreateTicketTool(
  scope: GuestBotScope,
  action: Extract<ChatbotAction, { type: "create_ticket" }>,
) {
  const cfg = action.config;
  const fieldList = cfg.fields
    .map((f) => `${f.label}${f.required ? " (required)" : ""}`)
    .join(", ");
  const kindNoun =
    cfg.kind === "order" ? "order" : cfg.kind === "maintenance" ? "maintenance issue" : "request";

  return tool({
    description: withWhenToUse(
      `File a ${kindNoun} as a ticket for the staff. Confirm the details with the guest BEFORE calling this. Include every detail in \`details\`${fieldList ? ` — make sure you've collected: ${fieldList}` : ""}. Returns a confirmation you should relay to the guest.`,
      action.whenToUse,
    ),
    inputSchema: z.object({
      title: z
        .string()
        .describe('Short ticket title, e.g. "Room service order — Room 204"'),
      details: z
        .string()
        .describe("Everything staff need to act: items/quantities, room or table, notes, allergies."),
    }),
    execute: async ({ title, details }) => {
      const guest = await loadGuest(scope);
      const guestLine = [
        guest.guest_name && `Guest: ${guest.guest_name}`,
        guest.room_number && `Room: ${guest.room_number}`,
        guest.guest_phone && `Phone: ${guest.guest_phone}`,
      ]
        .filter(Boolean)
        .join(" · ");

      if (scope.sandbox) {
        return {
          simulated: true,
          would_create: { title, details, kind: cfg.kind, priority: cfg.priority },
          note: "Test mode — no ticket was filed. In a live conversation this creates a task for the team.",
        };
      }

      const supabase = createServiceClient();
      const description = [
        details,
        guestLine,
        `—\nFiled by the "${scope.chatbotName}" chatbot from a guest conversation.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          property_id: scope.propertyId,
          title,
          description,
          space_id: cfg.spaceId ?? null,
          project_id: cfg.projectId ?? null,
          assignee_id: cfg.assigneeId ?? null,
          priority: cfg.priority,
          status: "todo",
          source: "ai",
        })
        .select("id")
        .single();
      if (error || !task) {
        console.error("[guest-bot] ticket insert failed", error?.message);
        return { ok: false, error: "Couldn't file the ticket — offer to connect the guest with staff instead." };
      }

      // Conversation outcome — orders get their own badge in the inbox.
      const { data: convo } = await supabase
        .from("chatbot_conversations")
        .select("outcome_meta")
        .eq("id", scope.conversationId)
        .maybeSingle();
      const meta = (convo?.outcome_meta ?? {}) as Record<string, unknown>;
      const taskIds = Array.isArray(meta.taskIds) ? (meta.taskIds as string[]) : [];
      await supabase
        .from("chatbot_conversations")
        .update({
          outcome: cfg.kind === "order" ? "order_placed" : "resolved",
          outcome_meta: { ...meta, taskIds: [...taskIds, task.id] },
        })
        .eq("id", scope.conversationId)
        .eq("property_id", scope.propertyId);

      if (cfg.notifyChannelId) {
        await postToStaffChannel(
          cfg.notifyChannelId,
          [
            `🎫 New ${kindNoun} from the "${scope.chatbotName}" chatbot`,
            "",
            `**${title}**`,
            details,
            guestLine,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      await emitWorkflowEvent({
        propertyId: scope.propertyId,
        source: "chatbot",
        eventType: "chatbot.order_created",
        entityId: task.id,
        entityKind: "task",
        payload: {
          chatbot_id: scope.chatbotId,
          chatbot_name: scope.chatbotName,
          conversation_id: scope.conversationId,
          guest_name: guest.guest_name,
          room_number: guest.room_number,
          task_id: task.id,
          kind: cfg.kind,
          title,
          details,
        },
      });

      return {
        ok: true,
        ticket_id: task.id,
        note: "Ticket filed — confirm to the guest that the team has it.",
      };
    },
  });
}

/**
 * Flip a conversation to human mode and alert the team: status update,
 * Stream card to the configured channel, `guest_escalation` notifications
 * to the configured roles, `chatbot.escalated` workflow event. Shared by
 * the bot's handoff tool and the guest page's deterministic "Talk to a
 * human" button (research is unambiguous: never bot-judgment-only).
 */
export async function performGuestHandoff(
  scope: Omit<GuestBotScope, "sandbox">,
  cfg: Extract<ChatbotAction, { type: "escalate_to_human" }>["config"],
  args: { summary: string; reason: string },
): Promise<void> {
  const supabase = createServiceClient();
  const guest = await loadGuest({ ...scope, sandbox: false });

  await supabase
    .from("chatbot_conversations")
    .update({ status: "human", outcome: "escalated" })
    .eq("id", scope.conversationId)
    .eq("property_id", scope.propertyId);

  const guestLine = [
    guest.guest_name && `Guest: ${guest.guest_name}`,
    guest.room_number && `Room: ${guest.room_number}`,
    guest.guest_phone && `Phone: ${guest.guest_phone}`,
    guest.guest_email && `Email: ${guest.guest_email}`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (cfg.channelId) {
    await postToStaffChannel(
      cfg.channelId,
      [
        `🙋 A guest needs a human — "${scope.chatbotName}" chatbot`,
        "",
        args.summary,
        guestLine,
        `Reason: ${args.reason}`,
        `Reply from Chatbots → Conversations in the app.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // Notify the configured roles. Fail-soft like every notification path.
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("property_id", scope.propertyId)
    .in("role", cfg.notifyRoles);
  await createNotifications(
    (members ?? []).map((m) => ({
      userId: m.user_id,
      propertyId: scope.propertyId,
      type: "guest_escalation" as const,
      payload: {
        chatbotId: scope.chatbotId,
        chatbotName: scope.chatbotName,
        conversationId: scope.conversationId,
        guestName: guest.guest_name,
        roomNumber: guest.room_number,
        summary: args.summary,
        reason: args.reason,
      },
    })),
  );

  await emitWorkflowEvent({
    propertyId: scope.propertyId,
    source: "chatbot",
    eventType: "chatbot.escalated",
    entityId: scope.conversationId,
    entityKind: "chatbot_conversation",
    payload: {
      chatbot_id: scope.chatbotId,
      chatbot_name: scope.chatbotName,
      conversation_id: scope.conversationId,
      guest_name: guest.guest_name,
      room_number: guest.room_number,
      summary: args.summary,
      reason: args.reason,
    },
  });
}

function buildHandoffTool(
  scope: GuestBotScope,
  action: Extract<ChatbotAction, { type: "escalate_to_human" }>,
  config: ChatbotConfig,
) {
  return tool({
    description: withWhenToUse(
      "Hand this conversation to a human staff member. Use when the guest asks for a person, you can't help after trying, or the topic is sensitive (complaints, billing, safety). After calling this, tell the guest someone will reply right here.",
      action.whenToUse,
    ),
    inputSchema: z.object({
      summary: z
        .string()
        .describe("2-3 sentence summary for staff: who the guest is, what they need, what you already tried."),
      reason: z.string().describe('Why you\'re escalating, e.g. "guest asked for a person"'),
    }),
    execute: async ({ summary, reason }) => {
      if (scope.sandbox) {
        return {
          simulated: true,
          would_escalate: { summary, reason },
          note: "Test mode — no staff were notified. In a live conversation this alerts the team and pauses the bot.",
        };
      }
      await performGuestHandoff(scope, action.config, { summary, reason });
      return {
        ok: true,
        note: `Staff notified. Tell the guest: "${config.guardrails.handoffMessage}" — then stop replying; a human takes over.`,
      };
    },
  });
}

/** Tool-safe name for a user-titled custom action ("Check rates" → custom_check_rates). */
function customToolName(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "action";
  let candidate = `custom_${slug}`;
  let i = 2;
  while (taken.has(candidate)) candidate = `custom_${slug}_${i++}`;
  return candidate;
}

/**
 * User-defined HTTP action → tool. The input schema is built from the
 * staff-authored param list, so the model can only supply declared,
 * typed parameters; everything else (URL, headers, allowlist) is fixed
 * server-side. Custom actions run live even in the test console — they hit
 * the property's own API, which is exactly what staff are there to verify.
 */
function buildCustomActionTool(row: CustomActionRow) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of row.param_schema) {
    let t: z.ZodTypeAny =
      field.type === "number"
        ? z.number()
        : field.type === "boolean"
          ? z.boolean()
          : z.string();
    if (field.description) t = t.describe(field.description);
    shape[field.name] = field.required ? t : t.optional();
  }
  return tool({
    description: withWhenToUse(
      `Call the property's "${row.name}" integration.`,
      row.when_to_use ?? undefined,
    ),
    inputSchema: z.object(shape),
    execute: async (params) => {
      const result = await executeCustomAction(row, params as Record<string, unknown>);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          note: "The integration call failed — apologize briefly and offer the team instead. Do not retry more than once.",
        };
      }
      return { ok: true, status: result.status, data: result.data };
    },
  });
}

/**
 * Booking tools — the Slang.ai/Cal.ai-converged conversational flow:
 * slot-fill (service/date/party) → check availability → offer a few
 * options or nearest alternatives → explicit confirm → book. Availability
 * and booking validity are 100% deterministic (lib/bookings/availability);
 * these tools only relay what that code returns.
 */
function buildBookingTools(
  scope: GuestBotScope,
  action: Extract<ChatbotAction, { type: "book_service" }>,
  tools: ToolSet,
) {
  const cfg = action.config;

  /** Allowed, active services for this bot — resolved live per call. */
  async function loadServices(): Promise<BookableServiceRow[]> {
    const supabase = createServiceClient();
    let query = supabase
      .from("bookable_services")
      .select("*")
      .eq("property_id", scope.propertyId)
      .eq("active", true)
      .is("archived_at", null);
    if (cfg.serviceIds.length > 0) query = query.in("id", cfg.serviceIds);
    const { data } = await query;
    return (data ?? []) as BookableServiceRow[];
  }

  /** The service's attached booking form, if any (memoized per service id
   *  across this turn's tool calls). */
  const formCache = new Map<string, BookingFormPayload | null>();
  async function formForService(
    s: BookableServiceRow,
  ): Promise<BookingFormPayload | null> {
    const formId = parseServiceSchedule(s.schedule).formId;
    if (!formId) return null;
    if (!formCache.has(s.id)) {
      formCache.set(s.id, await loadBookingForm(formId, scope.propertyId));
    }
    return formCache.get(s.id) ?? null;
  }

  function describeService(s: BookableServiceRow) {
    const schedule = parseServiceSchedule(s.schedule);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      duration_minutes: schedule.durationMinutes,
      max_party_size: schedule.maxPartySize,
      ...(schedule.priceLabel ? { price: schedule.priceLabel } : {}),
      ...(s.booking_mode === "rental" && schedule.rentalDurations.length > 0
        ? {
            duration_options_minutes: schedule.rentalDurations,
            note: "Rental — ask the guest which duration they want before checking availability.",
          }
        : {}),
      ...(s.kind === "event" && Object.keys(schedule.dates).length > 0
        ? { event_dates: Object.keys(schedule.dates).sort() }
        : {}),
    };
  }

  function resolveService(
    services: BookableServiceRow[],
    nameOrId: string,
  ): BookableServiceRow | null {
    const needle = nameOrId.trim().toLowerCase();
    return (
      services.find((s) => s.id === nameOrId) ??
      services.find((s) => s.name.toLowerCase() === needle) ??
      services.find((s) => s.name.toLowerCase().includes(needle)) ??
      (services.length === 1 ? services[0] : null)
    );
  }

  tools.check_availability = tool({
    description: withWhenToUse(
      "Check real availability for a bookable service (table, spa appointment, tour). Call with no service to list what can be booked. ALWAYS check availability before telling a guest a time works — never guess or invent open slots.",
      action.whenToUse,
    ),
    inputSchema: z.object({
      service: z
        .string()
        .optional()
        .describe("Service name or id. Omit to list the bookable services."),
      date: z
        .string()
        .optional()
        .describe('Date to check, "YYYY-MM-DD" in the property\'s local calendar.'),
      party_size: z.number().int().min(1).optional().describe("Number of guests"),
      duration_minutes: z
        .number()
        .int()
        .optional()
        .describe("Rentals only: the guest's chosen duration (one of the service's duration_options_minutes)"),
    }),
    execute: async ({ service, date, party_size, duration_minutes }) => {
      const services = await loadServices();
      if (services.length === 0) {
        return { services: [], note: "Nothing is bookable right now — offer to connect the guest with staff." };
      }
      if (!service) {
        return { services: services.map(describeService) };
      }
      const resolved = resolveService(services, service);
      if (!resolved) {
        return {
          error: "Unknown service",
          services: services.map(describeService),
        };
      }
      const today = todayInTz(resolved.timezone);
      const targetDate = date ?? today;
      const slots = await getServiceAvailability({
        service: resolved,
        date: targetDate,
        partySize: party_size ?? 1,
        durationMinutes: duration_minutes,
      });
      // Surface any booking questions so the bot knows to collect them
      // before it calls create_booking.
      const form = await formForService(resolved);
      return {
        service: describeService(resolved),
        date: targetDate,
        today_at_property: today,
        // ≤8 options keeps replies conversational; the model offers 2-3.
        slots: slots.slice(0, 8).map((s) => ({
          starts_at: s.startsAt,
          local_time: s.label,
          spots_left: s.remaining,
        })),
        more_slots: Math.max(0, slots.length - 8),
        ...(form
          ? {
              booking_questions: describeBookingQuestions(form.fields),
              booking_questions_note:
                "This service requires extra info. Ask these questions conversationally once the guest picks a time, then pass the answers to create_booking as form_answers (keyed by field_id; use the option id for choices).",
            }
          : {}),
        note:
          slots.length === 0
            ? "Nothing free that day for that party size — check a nearby date and offer alternatives."
            : "Offer the guest 2-3 of these options conversationally; don't dump the whole list.",
      };
    },
  });

  tools.create_booking = tool({
    description: withWhenToUse(
      "Book a slot the guest has explicitly confirmed. Before calling: (1) check_availability for the slot, (2) collect the guest's name, (3) if check_availability returned booking_questions, ask them and pass the answers as form_answers, (4) restate service + date + time + party size and get a clear yes. Returns a reference code to relay.",
      action.whenToUse,
    ),
    inputSchema: z.object({
      service: z.string().describe("Service name or id"),
      starts_at: z
        .string()
        .describe("Exact starts_at ISO timestamp from a check_availability slot"),
      party_size: z.number().int().min(1).default(1),
      guest_name: z.string().describe("The guest's name"),
      guest_phone: z.string().optional(),
      duration_minutes: z
        .number()
        .int()
        .optional()
        .describe("Rentals only: the confirmed duration choice"),
      notes: z.string().optional().describe("Special requests, allergies, occasion"),
      form_answers: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Answers to the service's booking_questions, keyed by field_id (use the option id for choice questions). Only when check_availability returned booking_questions.",
        ),
    }),
    execute: async (input) => {
      const services = await loadServices();
      const resolved = resolveService(services, input.service);
      if (!resolved) {
        return { ok: false, error: "Unknown service", services: services.map(describeService) };
      }

      // Booking questions: coerce + validate BEFORE creating anything, so a
      // missing required answer sends the bot back to ask rather than burning
      // a slot (mirrors the web 422 flow, conversationally).
      const form = await formForService(resolved);
      let cleanAnswers: FormAnswers = {};
      let notes = input.notes ?? null;
      if (form) {
        const coerced = coerceBookingAnswers(form.fields, input.form_answers ?? {});
        const validated = validateBookingAnswers(form.fields, coerced);
        if (!validated.ok) {
          return {
            ok: false,
            needs_answers: true,
            field_errors: validated.errors,
            booking_questions: describeBookingQuestions(form.fields),
            note: "Some required questions are missing or invalid. Ask the guest, then call create_booking again with form_answers.",
          };
        }
        cleanAnswers = validated.answers;
        const summary = summarizeAnswers(form.fields, validated.answers);
        if (summary) notes = notes ? `${notes} · ${summary}` : summary;
      }

      if (scope.sandbox) {
        return {
          simulated: true,
          would_book: {
            service: resolved.name,
            starts_at: input.starts_at,
            party_size: input.party_size,
            guest_name: input.guest_name,
            ...(form ? { booking_answers: cleanAnswers } : {}),
          },
          note: "Test mode — no booking was made. In a live conversation this reserves the slot.",
        };
      }

      const guest = await loadGuest(scope);
      const result = await createBookingChecked({
        service: resolved,
        startsAt: input.starts_at,
        partySize: input.party_size,
        guestName: input.guest_name,
        guestPhone: input.guest_phone ?? guest.guest_phone,
        notes,
        autoConfirm: cfg.autoConfirm,
        source: "chatbot",
        chatbotId: scope.chatbotId,
        conversationId: scope.conversationId,
        durationMinutes: input.duration_minutes,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          alternatives: (result.alternatives ?? []).map((s) => ({
            starts_at: s.startsAt,
            local_time: s.label,
          })),
          note: "Offer the nearest alternatives — never claim the original time is booked.",
        };
      }

      const booking = result.booking;
      const when = formatSlotForGuest(
        { startsAt: booking.starts_at, endsAt: booking.ends_at, label: "", remaining: 0 },
        resolved.timezone,
      );

      // The organizer's booking-form answers also land in the Forms feature
      // (responses table, analytics). Fail-soft — notes already carry them.
      if (form) {
        await recordBookingFormResponse({
          formId: form.formId,
          propertyId: scope.propertyId,
          answers: cleanAnswers,
          reference: booking.reference,
        });
      }

      const supabase = createServiceClient();
      const { data: convo } = await supabase
        .from("chatbot_conversations")
        .select("outcome_meta")
        .eq("id", scope.conversationId)
        .maybeSingle();
      const meta = (convo?.outcome_meta ?? {}) as Record<string, unknown>;
      const bookingIds = Array.isArray(meta.bookingIds)
        ? (meta.bookingIds as string[])
        : [];
      await supabase
        .from("chatbot_conversations")
        .update({
          outcome: "booking_made",
          outcome_meta: { ...meta, bookingIds: [...bookingIds, booking.id] },
          ...(input.guest_name && !guest.guest_name
            ? { guest_name: input.guest_name }
            : {}),
          ...(input.guest_phone && !guest.guest_phone
            ? { guest_phone: input.guest_phone }
            : {}),
        })
        .eq("id", scope.conversationId)
        .eq("property_id", scope.propertyId);

      if (cfg.notifyChannelId) {
        await postToStaffChannel(
          cfg.notifyChannelId,
          [
            `📅 New booking via the "${scope.chatbotName}" chatbot`,
            "",
            `**${resolved.name}** — ${when}`,
            `${booking.guest_name} · party of ${booking.party_size}${booking.guest_phone ? ` · ${booking.guest_phone}` : ""}`,
            booking.notes ? `Notes: ${booking.notes}` : null,
            `${booking.reference} · ${booking.status === "pending" ? "PENDING — needs staff confirmation" : "confirmed"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      return {
        ok: true,
        reference: booking.reference,
        status: booking.status,
        when,
        note:
          booking.status === "pending"
            ? `Booked as PENDING — tell the guest the team will confirm shortly and give them reference ${booking.reference}.`
            : `Confirmed — relay the details and reference ${booking.reference} to the guest.`,
      };
    },
  });
}

/**
 * Tool subset for a custom bot deployed into a STAFF Stream channel: its
 * knowledge base + custom API actions, without the guest-conversation tools
 * (no guest to collect details from, no conversation row to escalate).
 * Merged on top of the channel bot's property tools by ai-reply.
 */
export function buildChannelDeploymentTools(
  chatbotId: string,
  chatbotName: string,
  customActions: CustomActionRow[],
): ToolSet {
  const tools: ToolSet = {
    search_knowledge: tool({
      description: `Search the "${chatbotName}" bot's trained knowledge base — menus, policies, hours, FAQs the team curated for it.`,
      inputSchema: z.object({
        query: z.string().describe("Search terms, rephrased as keywords"),
      }),
      execute: async ({ query }) => {
        const hits = await searchChatbotKnowledge({ chatbotId, query });
        if (hits.length === 0) {
          return { results: [], note: "No matches in the knowledge base." };
        }
        return {
          results: hits.map((h) => ({ source: h.sourceTitle, content: h.content })),
        };
      },
    }),
  };
  const taken = new Set(Object.keys(tools));
  for (const row of customActions) {
    if (!row.enabled) continue;
    const name = customToolName(row.name, taken);
    taken.add(name);
    tools[name] = buildCustomActionTool(row);
  }
  return tools;
}

/**
 * Build the bot's tool set from its saved config — enabled actions only.
 * The returned names are what the model sees; keep them verb_noun and stable
 * (the transcript inspector renders them).
 */
export function buildGuestBotTools(
  scope: GuestBotScope,
  config: ChatbotConfig,
  customActions: CustomActionRow[] = [],
): ToolSet {
  const tools: ToolSet = {};
  for (const action of config.actions) {
    if (!action.enabled) continue;
    switch (action.type) {
      case "answer_from_knowledge":
        tools.search_knowledge = buildSearchKnowledgeTool(scope, action);
        break;
      case "collect_guest_info":
        tools.save_guest_details = buildSaveGuestDetailsTool(scope, action);
        break;
      case "create_ticket":
        tools.create_ticket = buildCreateTicketTool(scope, action);
        break;
      case "escalate_to_human":
        tools.handoff_to_human = buildHandoffTool(scope, action, config);
        break;
      case "book_service":
        buildBookingTools(scope, action, tools);
        break;
    }
  }
  const taken = new Set(Object.keys(tools));
  for (const row of customActions) {
    if (!row.enabled) continue;
    const name = customToolName(row.name, taken);
    taken.add(name);
    tools[name] = buildCustomActionTool(row);
  }
  return tools;
}
