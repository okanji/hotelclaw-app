import { defineMemory } from "eve/memory";
import { hotelclawMemory } from "../lib/memory-provider";

/**
 * Shared property memory — recalled into EVERY session of the property
 * (channel bot, assistant, stored agents, pod bots) and written by their
 * `property__remember` tool plus the app's deterministic writers (meeting
 * outcomes, accepted triage routings, workflow capture steps, tool-outcome
 * hook). Tenancy = the verified `propertyId` auth attribute; a session
 * without one (bare smoke tests, subagent children) gets no slot at all —
 * eve never falls back to a shared scope.
 */
export default defineMemory({
  description:
    "The property's shared memory: what the team and its bots have learned — recurring issues and their fixes, supplier and vendor behaviour, decisions and why, guest-relevant lore, standing facts not written in any document.",
  // Explicit namespace: the store partitions by property id itself, and the
  // same property must recall the same memory from dev, preview and prod.
  namespace: "hotelclaw/property",
  provider: hotelclawMemory("property"),
  scope(ctx) {
    const propertyId = ctx.session.auth.current?.attributes?.propertyId;
    return typeof propertyId === "string" && propertyId ? [propertyId] : null;
  },
});
