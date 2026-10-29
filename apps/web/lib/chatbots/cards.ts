import { z } from "zod";

/**
 * Chat render cards — a small, owned, versioned schema for the structured UI
 * a guest bot can show beneath its streamed prose reply. Same philosophy as
 * lib/forms/schema.ts: we own the shape (no json-render dependency) and the
 * server fills it from deterministic tool results, never the model's free
 * text. The model still writes the conversational sentence; these cards make
 * the underlying data (services, slots, confirmations) tappable.
 *
 * Cards are persisted on chatbot_messages.attachments and render identically
 * on the guest page, the test console, and the staff transcript. The only
 * producers were the booking tools, removed with the Bookings feature
 * (2026-10-29): nothing derives new cards today, but historical rows still
 * carry `services` / `slots` / `booking_confirmed` cards, so the schema and
 * renderer stay for reading them.
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
