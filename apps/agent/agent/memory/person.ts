import { defineMemory } from "eve/memory";
import { hotelclawMemory } from "../lib/memory-provider";

/**
 * Per-person memory — preferences and working notes about the human the
 * bot is talking to (how they like briefs written, what they own, standing
 * reminders). Scoped to (property, person): the PERSON is the real message
 * sender when the channel bot acts as a fallback principal (`senderId`
 * attribute), else the authenticated user. Runtime/service principals and
 * sessions without a property get no slot.
 */
export default defineMemory({
  description:
    "Notes about the person you are talking to: their preferences, responsibilities, how they like things done, standing reminders they asked for. Personal to them — never property-wide facts (those belong in property memory).",
  namespace: "hotelclaw/person",
  provider: hotelclawMemory("user"),
  scope(ctx) {
    const current = ctx.session.auth.current;
    const propertyId = current?.attributes?.propertyId;
    if (current?.principalType !== "user" || typeof propertyId !== "string" || !propertyId) {
      return null;
    }
    const sender = current.attributes?.senderId;
    const personId =
      typeof sender === "string" && sender ? sender : current.principalId;
    return personId ? [propertyId, personId] : null;
  },
});
