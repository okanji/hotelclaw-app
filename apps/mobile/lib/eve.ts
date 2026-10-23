import { fetch as expoFetch } from "expo/fetch";
import { apiBaseUrl } from "../chatConfig";
import { supabase } from "./supabase";

/**
 * The eve agent runtime over HTTP, from the phone.
 *
 * Same routes the web app uses (`/eve/v1/*`, mounted by withEve on the web
 * server), but authenticated with the Supabase access token as a Bearer
 * (`supabaseBearerAuth` in apps/agent/agent/channels/eve.ts — the app has
 * no cookies). Streaming needs `expo/fetch`: React Native's global fetch
 * buffers the whole body, and an eve session stream never closes.
 */
export class EveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function eveHeaders(
  propertyId: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new EveError(401, "No Supabase session");
  return {
    Authorization: `Bearer ${session.access_token}`,
    "content-type": "application/json",
    "x-hotelclaw-property": propertyId,
    ...extra,
  };
}

export type EveDelivery =
  | { message: string }
  | { inputResponses: { requestId: string; optionId?: string; text?: string }[] };

/** POST a delivery; `sessionId` null creates a session. Throws EveError (409 = expired). */
export async function eveDeliver(
  sessionId: string | null,
  headers: Record<string, string>,
  body: EveDelivery,
): Promise<{ sessionId: string }> {
  const url = `${apiBaseUrl}/eve/v1/session${sessionId ? `/${sessionId}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new EveError(0, `Can't reach the agent runtime at ${apiBaseUrl}`);
  }
  if (!res.ok) {
    throw new EveError(
      res.status,
      res.status === 401
        ? "You're not authorized for this workspace."
        : res.status === 409
          ? "This conversation expired."
          : `The agent runtime returned ${res.status}.`,
    );
  }
  const payload = (await res.json()) as { sessionId?: string };
  const id = payload.sessionId ?? sessionId;
  if (!id) throw new EveError(500, "No session id came back.");
  return { sessionId: id };
}

export async function eveCancel(sessionId: string, headers: Record<string, string>) {
  await fetch(`${apiBaseUrl}/eve/v1/session/${sessionId}/cancel`, {
    method: "POST",
    headers,
    body: "{}",
  }).catch(() => null);
}

/**
 * Read a session's NDJSON event stream. Yields parsed events; the caller
 * decides when to stop (abort the signal). `idleMs` ends the read when the
 * stream goes quiet — a parked session's replay just stops arriving.
 */
export async function* eveStream(
  sessionId: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  idleMs: number | null,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const res = await expoFetch(`${apiBaseUrl}/eve/v1/session/${sessionId}/stream`, {
    headers,
    signal,
  });
  if (!res.ok || !res.body) {
    throw new EveError(res.status, `Could not attach to the conversation (${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawData = false;
  try {
    for (;;) {
      const chunk =
        idleMs === null
          ? await reader.read()
          : await Promise.race([
              reader.read(),
              new Promise<{ done: true; value?: undefined }>((resolve) =>
                setTimeout(() => resolve({ done: true }), sawData ? idleMs : 20_000),
              ),
            ]);
      if (chunk.done) return;
      sawData = true;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as { type: string; data: Record<string, unknown> };
        } catch {
          // Partial line on abort — skip.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
