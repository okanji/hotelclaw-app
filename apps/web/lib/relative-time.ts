/**
 * Compact "how long ago" for row meta — `just now`, `4m`, `3h`, `2d`,
 * `5mo`, `1y`. Pure + client-safe; no date library (the platform's own
 * arithmetic is enough for a 12px faint label). Returns "" for unparseable
 * input so callers can render it unconditionally.
 */
export function relativeTimeShort(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const then = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}
