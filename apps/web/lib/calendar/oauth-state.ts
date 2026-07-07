import "server-only";
import { cookies } from "next/headers";

/**
 * Tiny CSRF helper for the Google/Microsoft OAuth callback. We sign a
 * single-use cookie value with `crypto.randomUUID()` and stuff the
 * "return-to-here" URL alongside it, so the callback can verify the state
 * came from our own connect handler and bounce the user back to where they
 * started (typically `/p/<id>/calendar`).
 *
 * Two cookies because we want the callback to be able to clear them
 * independently (state is one-shot; the `next` URL is whatever we stash).
 */

const STATE_COOKIE = "calendar_oauth_state";
const NEXT_COOKIE = "calendar_oauth_next";

export async function startOAuth(next: string | null): Promise<string> {
  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  if (next) {
    store.set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
  }
  return state;
}

/** Pops state + next. Returns null when state mismatches. */
export async function consumeOAuth(
  receivedState: string | null,
): Promise<{ next: string } | null> {
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value ?? null;
  const rawNext = store.get(NEXT_COOKIE)?.value ?? "/";
  store.delete(STATE_COOKIE);
  store.delete(NEXT_COOKIE);
  if (!expected || !receivedState || expected !== receivedState) return null;
  return { next: safeNext(rawNext) };
}

/**
 * Open-redirect guard: only accept paths that start with `/` and don't
 * smuggle in a `//host` or `/\host` prefix (browsers treat both as
 * protocol-relative URLs). Anything else falls back to `/`.
 *
 * Cookies are httpOnly + sameSite=lax, so an attacker would already need
 * to plant the value via our own startOAuth, but `next` originates in a
 * query string — never trust it without normalisation.
 */
function safeNext(raw: string): string {
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
