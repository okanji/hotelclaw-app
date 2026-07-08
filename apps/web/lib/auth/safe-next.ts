/**
 * Sanitize a `?next=` redirect target: only same-origin absolute paths pass.
 * Rejects protocol-relative (`//evil.com`), backslash tricks, and full URLs —
 * everything that would turn an auth endpoint into an open redirect. Shared
 * by /auth/confirm, /auth/callback, /login, and /welcome.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
