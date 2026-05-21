import "server-only";

/**
 * Minimal Google Calendar API wrapper. We call the JSON REST endpoints
 * directly via `fetch` rather than pulling in `googleapis` — three
 * endpoints, no streaming, no need for the SDK's surface area.
 *
 * Tokens are stored in `calendar_connections`. The wrapper consumes/refreshes
 * tokens through callbacks so the storage layer (Supabase) stays out of
 * this file — easier to mock and a cleaner boundary for the OAuth flow.
 *
 * Env vars (set in `.env.local` before this works):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (e.g. https://host/api/calendar/google/callback)
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function getAuthorizationUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "Google OAuth not configured: set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // `offline` is required for a refresh token. `consent` forces the
    // refresh-token re-issue on subsequent connects (Google only sends one
    // on the first authorize) — we'd be stuck if the user reconnected
    // without it and we'd already lost the original.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: "Bearer";
  scope: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Hit `userinfo` once during the OAuth callback so we can store the user's
 * email next to the connection row. Drives the "Connected as foo@…" line
 * in the section sidebar.
 */
export async function getUserInfo(accessToken: string): Promise<{
  email: string;
  name?: string;
}> {
  const res = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${await res.text()}`);
  }
  return res.json();
}

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole: string;
};

export async function listCalendars(
  accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Google calendarList failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { items?: GoogleCalendarListEntry[] };
  return json.items ?? [];
}

export type GoogleEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: "opaque" | "transparent";
  etag?: string;
  organizer?: { email: string; displayName?: string };
  recurringEventId?: string;
};

/**
 * Pull events for one calendar. Uses `syncToken` when available for an
 * incremental sync (Google's recommended pattern); falls back to a
 * time-window pull on the first sync. Returns the new sync token alongside
 * the events so callers can persist it.
 *
 * If Google rejects a stale `syncToken` (410 Gone), we surface that to the
 * caller so it can restart with a full sync.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  options: {
    syncToken?: string | null;
    timeMin?: string;
    timeMax?: string;
  },
): Promise<{
  events: GoogleEvent[];
  nextSyncToken: string | null;
  fullSyncRequired: boolean;
}> {
  const allEvents: GoogleEvent[] = [];
  let nextPageToken: string | undefined;
  let nextSyncToken: string | null = null;
  const fullSyncRequired = false;

  do {
    const params = new URLSearchParams({
      maxResults: "250",
      singleEvents: "true",
      showDeleted: "true",
    });
    if (options.syncToken) params.set("syncToken", options.syncToken);
    else {
      if (options.timeMin) params.set("timeMin", options.timeMin);
      if (options.timeMax) params.set("timeMax", options.timeMax);
    }
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId,
      )}/events?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 410) {
      // 410 Gone — sync token expired; tell the caller to restart full.
      return { events: [], nextSyncToken: null, fullSyncRequired: true };
    }
    if (!res.ok) {
      throw new Error(`Google events list failed: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    allEvents.push(...(json.items ?? []));
    nextPageToken = json.nextPageToken;
    if (json.nextSyncToken) nextSyncToken = json.nextSyncToken;
  } while (nextPageToken);

  return { events: allEvents, nextSyncToken, fullSyncRequired };
}

/**
 * Open a push channel for a calendar's events resource. Google delivers a
 * POST to `address` on every change; the receiver POSTs back to our sync
 * endpoint. Channels expire (max 7 days for events.watch) and need
 * renewal via `renewChannel` (just call `watchEvents` again with a new id).
 */
export async function watchEvents(
  accessToken: string,
  calendarId: string,
  options: { channelId: string; address: string; token?: string; ttlSeconds?: number },
): Promise<{ id: string; resourceId: string; expiration: string }> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events/watch`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: options.channelId,
        type: "web_hook",
        address: options.address,
        token: options.token,
        params: options.ttlSeconds
          ? { ttl: String(options.ttlSeconds) }
          : undefined,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Google watch failed: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Stop a previously-opened push channel. Best-effort — failure is
 * non-fatal (channels expire on their own).
 */
export async function stopGoogleWatch(
  accessToken: string,
  channel: Record<string, unknown>,
): Promise<void> {
  const id = channel.id as string | undefined;
  const resourceId = channel.resourceId as string | undefined;
  if (!id || !resourceId) return;
  await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, resourceId }),
  });
}

/** Normalise Google's flexible start/end into our `external_events` row shape. */
export function normaliseEventTimes(g: GoogleEvent): {
  start: string;
  end: string;
  all_day: boolean;
} {
  const all_day = !!g.start.date && !!g.end.date;
  if (all_day) {
    return {
      start: new Date(`${g.start.date}T00:00:00`).toISOString(),
      end: new Date(`${g.end.date}T00:00:00`).toISOString(),
      all_day: true,
    };
  }
  return {
    start: g.start.dateTime!,
    end: g.end.dateTime!,
    all_day: false,
  };
}
