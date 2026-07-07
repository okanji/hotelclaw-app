import { Fragment } from "react";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` into tokens, wrapping every case-insensitive match of any
 * whitespace-separated term from `query` in <mark>. Empty/whitespace queries
 * pass through unchanged.
 */
export function highlight(text: string, query: string) {
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "ig");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        const isMatch = i % 2 === 1;
        return isMatch ? (
          <mark
            key={i}
            className="rounded bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-400/30"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}
