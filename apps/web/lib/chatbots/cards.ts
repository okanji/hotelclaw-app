import { z } from "zod";

/**
 * Chat render cards — a small, owned, versioned schema for the structured UI
 * a guest bot can show beneath its streamed prose reply. Same philosophy as
 * lib/forms/schema.ts: we own the shape (no json-render dependency) and the
 * server fills it from deterministic tool results, never the model's free
 * text. The model still writes the conversational sentence; these cards make
 * the underlying data (services, slots, confirmations) tappable.
 *
 * Cards are derived in run-guest-bot's onFinish from the booking tools'
 * outputs and persisted on chatbot_messages.attachments, so they survive a
 * resync and render identically on the guest page, the test console, and the
 * staff transcript.
 */

export const ServiceCardItemZod = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  price: z.string().optional(),
  durationMinutes: z.number().optional(),
  description: z.string().nullish(),
});
export type ServiceCardItem = z.infer<typeof ServiceCardItemZod>;

export const ChatCardZod = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("services"),
    services: z.array(ServiceCardItemZod).max(12),
  }),
  z.object({
    type: z.literal("slots"),
    serviceName: z.string(),
    date: z.string(),
    slots: z
      .array(
        z.object({
          startsAt: z.string(),
          label: z.string(),
          spotsLeft: z.number().nullish(),
        }),
      )
      .max(8),
  }),
  z.object({
    type: z.literal("booking_confirmed"),
    reference: z.string(),
    serviceName: z.string(),
    when: z.string().optional(),
    partySize: z.number().optional(),
  }),
]);
export type ChatCard = z.infer<typeof ChatCardZod>;

export const ChatAttachmentsZod = z.array(ChatCardZod).max(4);
export type ChatAttachments = z.infer<typeof ChatAttachmentsZod>;

/** Tolerant parse for persisted/streamed attachments (older rows are null). */
export function parseChatAttachments(raw: unknown): ChatAttachments {
  if (!raw) return [];
  const parsed = ChatAttachmentsZod.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

type ToolResultLike = { toolName: string; output: unknown };

/**
 * Map a turn's booking-tool results to render cards. Reads the exact shapes
 * `check_availability` and `create_booking` return (lib/ai/guest-bot/tools/
 * registry.ts). Unknown/empty shapes yield nothing — a plain prose turn just
 * has no attachments. Only the LAST relevant result of each kind wins so a
 * multi-step turn shows the freshest state.
 */
export function cardsFromToolResults(
  toolResults: ToolResultLike[],
): ChatAttachments {
  const cards: ChatCard[] = [];

  for (const tr of toolResults) {
    const out = tr.output as Record<string, unknown> | null;
    if (!out || typeof out !== "object") continue;

    if (tr.toolName === "check_availability") {
      // Availability view: { service, date, slots: [...] }
      if (Array.isArray(out.slots) && out.slots.length > 0) {
        const service = out.service as { name?: string } | undefined;
        const slots = (out.slots as Array<Record<string, unknown>>)
          .slice(0, 8)
          .map((s) => ({
            startsAt: String(s.starts_at ?? ""),
            label: String(s.local_time ?? ""),
            spotsLeft:
              typeof s.spots_left === "number" ? s.spots_left : undefined,
          }))
          .filter((s) => s.startsAt && s.label);
        if (slots.length > 0) {
          replaceOrPush(cards, {
            type: "slots",
            serviceName: service?.name ?? "Service",
            date: String(out.date ?? ""),
            slots,
          });
        }
      } else if (Array.isArray(out.services) && out.services.length > 0) {
        // List view: { services: [{id,name,kind,price,duration_minutes,...}] }
        const services = (out.services as Array<Record<string, unknown>>)
          .slice(0, 12)
          .map((s) => ({
            id: String(s.id ?? ""),
            name: String(s.name ?? "Service"),
            kind: typeof s.kind === "string" ? s.kind : undefined,
            price: typeof s.price === "string" ? s.price : undefined,
            durationMinutes:
              typeof s.duration_minutes === "number"
                ? s.duration_minutes
                : undefined,
            description:
              typeof s.description === "string" ? s.description : null,
          }))
          .filter((s) => s.id);
        if (services.length > 0) {
          replaceOrPush(cards, { type: "services", services });
        }
      }
    }

    if (tr.toolName === "create_booking" && out.ok === true && out.reference) {
      const booked = (out.booked ?? out.would_book ?? {}) as Record<
        string,
        unknown
      >;
      replaceOrPush(cards, {
        type: "booking_confirmed",
        reference: String(out.reference),
        serviceName: String(
          (out.service as { name?: string } | undefined)?.name ??
            booked.service ??
            "Your booking",
        ),
        when:
          typeof booked.when === "string"
            ? booked.when
            : typeof out.when === "string"
              ? out.when
              : undefined,
        partySize:
          typeof booked.party_size === "number" ? booked.party_size : undefined,
      });
    }
  }

  return cards.slice(0, 4);
}

/** Keep one card per type — the latest tool result of that kind wins. */
function replaceOrPush(cards: ChatCard[], card: ChatCard) {
  const i = cards.findIndex((c) => c.type === card.type);
  if (i >= 0) cards[i] = card;
  else cards.push(card);
}
