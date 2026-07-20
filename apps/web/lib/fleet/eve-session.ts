import "server-only";
/**
 * Shared server-side eve session helpers for the fleet stack. Centralizes
 * the origin resolution (previously duplicated in pod-bot-reply and the
 * actions-MCP route) and the deadline-raced stream tail read used to
 * classify a session and recover its live continuation token.
 *
 * Eve streams REPLAY from index 0 on every attach and stay OPEN after the
 * last event, so: (a) a tail read always sees the full history including
 * the latest `session.waiting` (which carries the current continuation
 * token), and (b) every read must be raced against a deadline — a bare
 * reader.read() on an idle stream blocks forever.
 */

export function eveOrigin(): string {
  // On Vercel the eve Build Output service is reached through the
  // deployment's own routing layer — VERCEL_URL (no protocol) is the
  // per-deployment host, correct for previews and prod alike. Local dev
  // keeps the same-server loopback.
  if (process.env.EVE_INTERNAL_ORIGIN) return process.env.EVE_INTERNAL_ORIGIN;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:3000";
}

export type PendingRequest = {
  toolName: string;
  input: unknown;
  callId: string | null;
};

export type SessionTail = {
  status: "running" | "waiting" | "awaiting_approval" | "completed" | "failed";
  lastMessage: string;
  pendingRequests: PendingRequest[];
  continuationToken: string | null;
};

export function parsePendingRequests(data: Record<string, unknown> | undefined): PendingRequest[] {
  const requests = Array.isArray(data?.requests)
    ? (data.requests as Array<Record<string, unknown>>)
    : [];
  return requests.map((r) => {
    // Shape (verified against eve 0.24): requests[].action = {toolName, input, callId}.
    const action = (r.action ?? {}) as Record<string, unknown>;
    return {
      toolName: typeof action.toolName === "string" ? action.toolName : "unknown",
      input: action.input ?? null,
      callId: typeof action.callId === "string" ? action.callId : null,
    };
  });
}

/**
 * Read a session's replayed event stream for up to `deadlineMs` and
 * classify it. `input.requested` events set awaiting_approval and populate
 * pendingRequests; a LATER completed turn clears them (the park resolved).
 */
export async function readSessionTail(
  sessionId: string,
  headers: Record<string, string>,
  {
    deadlineMs = 6000,
    breakOnSettle = false,
  }: {
    deadlineMs?: number;
    /** Stop at the first session.waiting/completed/failed. Only safe for
     * sessions known to have a single turn (fresh workflow runs) — a
     * multi-turn replay emits session.waiting after EVERY historical turn,
     * so breaking early there would classify from history. */
    breakOnSettle?: boolean;
  } = {},
): Promise<SessionTail | null> {
  const response = await fetch(
    `${eveOrigin()}/eve/v1/session/${encodeURIComponent(sessionId)}/stream`,
    { headers, signal: AbortSignal.timeout(deadlineMs + 3000) },
  ).catch(() => null);
  if (!response?.ok || !response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const tail: SessionTail = {
    status: "running",
    lastMessage: "",
    pendingRequests: [],
    continuationToken: null,
  };
  const deadline = Date.now() + deadlineMs;
  let settled = false;
  try {
    while (Date.now() < deadline && !(breakOnSettle && settled)) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true }), Math.max(50, deadline - Date.now())),
        ),
      ]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: { type?: string; data?: Record<string, unknown> };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "message.completed") {
          const text = event.data?.message;
          if (typeof text === "string" && text.trim()) tail.lastMessage = text;
        } else if (event.type === "input.requested") {
          tail.pendingRequests = parsePendingRequests(event.data);
          tail.status = "awaiting_approval";
        } else if (event.type === "turn.completed") {
          // A finished turn after a park means the park was resolved.
          if (tail.status === "awaiting_approval") {
            tail.status = "running";
            tail.pendingRequests = [];
          }
        } else if (event.type === "session.waiting") {
          const token = event.data?.continuationToken;
          tail.continuationToken = typeof token === "string" ? token : null;
          if (tail.status !== "awaiting_approval") tail.status = "waiting";
          settled = true;
        } else if (event.type === "session.completed") {
          tail.status = "completed";
          settled = true;
        } else if (event.type === "session.failed") {
          tail.status = "failed";
          settled = true;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return tail;
}

/** Service-caller headers for fleet eve requests (never client-supplied). */
export function fleetServiceHeaders(input: {
  propertyId: string;
  userId: string;
  botSlug?: string;
}): Record<string, string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("service key missing");
  return {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
    "x-hotelclaw-property": input.propertyId,
    "x-hotelclaw-user": input.userId,
    ...(input.botSlug ? { "x-hotelclaw-bot": input.botSlug } : {}),
  };
}
