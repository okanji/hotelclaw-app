import { useCallback, useEffect, useState } from "react";
import { apiBaseUrl } from "../chatConfig";
import { supabase } from "./supabase";

/**
 * Calls into the web app's property API with the Supabase session as a Bearer
 * token (`lib/auth/api-caller.ts` resolves cookie OR bearer, so mobile and web
 * hit the same handlers). Writes deliberately go through here rather than
 * straight to Postgres: the routes run the shared task mutations, which emit
 * assignment notifications and background triage that a direct insert skips.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new ApiError(401, "No Supabase session");
  return { Authorization: `Bearer ${token}` };
}

export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = await authHeader();
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    // fetch() rejects with a bare "Network request failed" — name the target so
    // a wrong EXPO_PUBLIC_API_URL is obvious rather than mysterious.
    throw new ApiError(0, `Can't reach the backend at ${apiBaseUrl}`);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Minimal fetch-on-mount hook. The mobile app has no react-query, and pulling
 * it in just for a handful of screens isn't worth the bundle — but every screen
 * still needs the same loading / error / refetch triple, so it lives here once.
 * Pass `null` as the path to skip (e.g. before a property is known).
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const refetch = useCallback(() => setAttempt((a) => a + 1), []);
  return { data, loading, error, refetch };
}

/* ── Shapes returned by the web API ──────────────────────────────────────── */

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export type RecordSource = "user" | "workflow" | "ai";

export type ApiTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: string | null;
  due_at: string | null;
  labels: string[];
  project_name: string | null;
  space_id: string | null;
  project_id: string | null;
  source: RecordSource;
  updated_at: string;
};

/** Team / project catalogues for the filter facets. Read straight from
 *  Supabase under RLS (see `useCatalogues`) — they're plain reference data, so
 *  they don't need the write-path API the task mutations do. */
export type NamedRow = { id: string; name: string };

export type CustomFieldRow = {
  id: string;
  name: string;
  type: string;
  options: unknown;
};

export type ApiMember = {
  id: string;
  role: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type ApiDocument = {
  id: string;
  title: string;
  kind: "doc" | "sheet";
  updated_at: string;
  body_text: string;
};

export type CalendarSource = "meeting" | "task" | "external" | "booking";

export type ApiCalendarEvent = {
  id: string;
  source: CalendarSource;
  start: string;
  end: string;
  all_day: boolean;
  title: string;
  description: string | null;
  location: string | null;
};

/** A single meeting row, as returned by `GET .../meetings/:id`. Only
 *  `source: "meeting"` events are editable — tasks, bookings and events synced
 *  from a connected external calendar are owned elsewhere. */
export type ApiMeeting = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  all_day: boolean;
  host_id: string | null;
  stream_call_type: string;
  attendees: { user_id: string; is_organizer: boolean }[];
};

export type SaveMeetingBody = {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  attendeeIds: string[];
  withVideoCall: boolean;
};
