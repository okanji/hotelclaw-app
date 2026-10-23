import "server-only";
/**
 * Guest-profile side-channel between the guest chatbots and property
 * memory. Guests are UNTRUSTED — they never get memory tools (a tool whose
 * args a guest influences is an injection/exfiltration path into shared
 * knowledge). Instead:
 *
 *   READ  — the server prefetches the guest's memory (keyed by a hash of
 *           their phone/email, never the raw identifier) and injects it
 *           into the system prompt as staff-curated context.
 *   WRITE — deterministic capture when a guest shares details via the
 *           save_guest_details tool (server-side, fixed shape — no model
 *           freetext reaches memory from a guest turn).
 *
 * Fail-soft everywhere: no identity / no rows / error ⇒ null, the bot runs
 * exactly as before.
 */
import { guestScope } from "@hotelclaw/memory";
import { memoryStore } from "@/lib/memory/store";

/** Prefetch the guest's remembered facts for prompt injection (trusted,
 *  staff/bot-curated content — bounded, never guest-authored freetext). */
export async function loadGuestProfile(
  propertyId: string,
  identity: { phone?: string | null; email?: string | null },
): Promise<string | null> {
  const scope = guestScope(propertyId, identity);
  if (!scope) return null;
  try {
    const rows = await memoryStore().recent(scope, 12);
    if (rows.length === 0) return null;
    const lines = rows.map((r) => `- ${r.created_at.slice(0, 10)}: ${r.content}`);
    return lines.join("\n").slice(0, 1500);
  } catch (err) {
    console.warn("[memory] guest profile load failed", { propertyId }, err);
    return null;
  }
}

/** Deterministic capture of guest-shared details (no model freetext). */
export async function captureGuestDetails(
  propertyId: string,
  input: {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    roomNumber?: string | null;
    botName: string;
  },
): Promise<void> {
  const scope = guestScope(propertyId, input);
  if (!scope) return;
  const facts = [
    input.name ? `name ${input.name}` : "",
    input.roomNumber ? `room ${input.roomNumber}` : "",
    input.phone ? "phone on file" : "",
    input.email ? "email on file" : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!facts) return;
  try {
    await memoryStore().remember({
      scope,
      kind: "fact",
      content: `Guest shared details via ${input.botName}: ${facts}.`,
      source: `guest chatbot, ${new Date().toISOString().slice(0, 10)}`,
      tags: ["guest"],
      createdVia: "app",
    });
  } catch (err) {
    // Fail-soft — never surface memory errors to a guest conversation.
    console.warn("[memory] guest capture failed", { propertyId }, err);
  }
}
