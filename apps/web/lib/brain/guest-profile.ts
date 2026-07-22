import "server-only";
/**
 * Guest-profile side-channel between the guest chatbots and the property
 * brain. Guests are UNTRUSTED — they never get brain tools (a tool whose
 * args a guest influences is an injection/exfiltration path into shared
 * knowledge). Instead:
 *
 *   READ  — the server prefetches the guest's profile page (keyed by a
 *           hash of their phone/email, never the raw identifier) and
 *           injects it into the system prompt as staff-curated context.
 *   WRITE — deterministic capture when a guest shares details via the
 *           save_guest_details tool (server-side, fixed shape — no model
 *           freetext reaches the brain from a guest turn).
 *
 * Fail-soft everywhere: no binding / no page / timeout ⇒ null, the bot
 * runs exactly as before.
 */
import { createHash } from "crypto";
import {
  captureToBrain,
  getBrainPage,
  resolvePropertyBrain,
} from "@/lib/brain/client";
import { logBrainEvent } from "@/lib/brain/telemetry";

export function guestSlug(identity: { phone?: string | null; email?: string | null }): string | null {
  const key = identity.phone?.replace(/[^0-9+]/g, "") || identity.email?.trim().toLowerCase();
  if (!key) return null;
  return `guests/${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Prefetch the guest's profile page content for prompt injection (trusted,
 *  staff/bot-curated brain content — truncated, never guest-authored). */
export async function loadGuestProfile(
  propertyId: string,
  identity: { phone?: string | null; email?: string | null },
): Promise<string | null> {
  const slug = guestSlug(identity);
  if (!slug) return null;
  try {
    const binding = await resolvePropertyBrain(propertyId);
    if (!binding) return null;
    const page = await getBrainPage(binding, slug);
    if (!page) return null;
    return page.slice(0, 1500);
  } catch (err) {
    logBrainEvent("search_unavailable", {
      surface: "guest-profile-load",
      propertyId,
      reason: err instanceof Error ? err.message : String(err),
    });
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
  const slug = guestSlug(input);
  if (!slug) return;
  try {
    const binding = await resolvePropertyBrain(propertyId);
    if (!binding) return;
    const facts = [
      input.name ? `name ${input.name}` : "",
      input.roomNumber ? `room ${input.roomNumber}` : "",
      input.phone ? "phone on file" : "",
      input.email ? "email on file" : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (!facts) return;
    const result = await captureToBrain(binding, {
      slug,
      pageTitle: input.name ? `Guest: ${input.name}` : "Guest profile",
      summary: `Guest shared details via ${input.botName}: ${facts}.`,
      source: `guest chatbot, ${new Date().toISOString().slice(0, 10)}`,
    });
    if (!result.ok) {
      logBrainEvent("capture_failed", {
        surface: "guest-details",
        propertyId,
        reason: result.reason,
      });
    }
  } catch (err) {
    // Fail-soft — never surface brain errors to a guest conversation.
    logBrainEvent("capture_failed", {
      surface: "guest-details",
      propertyId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
