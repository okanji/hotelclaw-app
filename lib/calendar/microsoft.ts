import "server-only";

/**
 * Minimal Microsoft Graph wrapper. Three endpoints (calendars, events
 * delta, /me), token exchange + refresh against the v2.0 auth endpoint.
 *
 * Multi-tenant via the `common` tenant id — accepts personal and work/school
 * accounts. Switch to a specific tenant when we move to enterprise SSO.
 *
 * Env vars:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_REDIRECT_URI
 */

const TENANT = "common";
const SCOPES = [
  "openid",
  "email",
  "offline_access",
  "Calendars.ReadWrite",
  "User.Read",
];

export function getAuthorizationUrl(state: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "Microsoft OAuth not configured: set MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    response_mode: "query",
    state,
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params}`;
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
  return tokenCall({
    code,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  return tokenCall({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

async function tokenCall(
  extra: Record<string, string>,
): Promise<TokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Microsoft OAuth not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    ...extra,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Microsoft token call failed: ${await res.text()}`);
  }
  return res.json();
}

export async function getUserInfo(accessToken: string): Promise<{
  email: string;
  name?: string;
}> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Microsoft /me failed: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  return {
    email: json.mail ?? json.userPrincipalName ?? "",
    name: json.displayName,
  };
}

export type GraphCalendar = {
  id: string;
  name: string;
  color?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  owner?: { name: string; address: string };
};

export async function listCalendars(
  accessToken: string,
): Promise<GraphCalendar[]> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendars",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Microsoft calendars failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { value?: GraphCalendar[] };
  return json.value ?? [];
}

export type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: "free" | "busy" | "tentative" | "oof" | "workingElsewhere";
  webLink?: string;
  organizer?: { emailAddress: { address: string; name?: string } };
  "@removed"?: { reason: string };
};

/**
 * Pull events with Graph's delta API. The `deltaLink` is stored as our
 * `sync_token`; on first sync we pass a calendar view window instead.
 */
export async function listEventsDelta(
  accessToken: string,
  calendarId: string,
  options: {
    deltaLink?: string | null;
    startDateTime?: string;
    endDateTime?: string;
  },
): Promise<{
  events: GraphEvent[];
  nextDeltaLink: string | null;
  fullSyncRequired: boolean;
}> {
  let urlStr: string;
  if (options.deltaLink) {
    urlStr = options.deltaLink;
  } else {
    const params = new URLSearchParams({
      startDateTime: options.startDateTime!,
      endDateTime: options.endDateTime!,
    });
    urlStr = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
      calendarId,
    )}/calendarView/delta?${params}`;
  }

  const allEvents: GraphEvent[] = [];
  let nextDeltaLink: string | null = null;

  while (urlStr) {
    const res = await fetch(urlStr, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 410) {
      return { events: [], nextDeltaLink: null, fullSyncRequired: true };
    }
    if (!res.ok) {
      throw new Error(`Microsoft delta failed: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      value?: GraphEvent[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    allEvents.push(...(json.value ?? []));
    if (json["@odata.deltaLink"]) {
      nextDeltaLink = json["@odata.deltaLink"];
      break;
    }
    if (!json["@odata.nextLink"]) break;
    urlStr = json["@odata.nextLink"];
  }

  return { events: allEvents, nextDeltaLink, fullSyncRequired: false };
}

export function normaliseEventTimes(g: GraphEvent): {
  start: string;
  end: string;
  all_day: boolean;
} {
  // Graph returns local-tz datetimes; appending `Z` makes them UTC-correct
  // when the timezone is UTC. For non-UTC we'd need full IANA conversion;
  // for v1 we accept that "WIP timezone fidelity" caveat and treat the
  // returned value as UTC since Graph defaults to UTC for /me/calendarView.
  return {
    start: `${g.start.dateTime}Z`,
    end: `${g.end.dateTime}Z`,
    all_day: !!g.isAllDay,
  };
}
