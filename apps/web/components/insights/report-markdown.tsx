"use client";

import ReactMarkdown from "react-markdown";

/**
 * Markdown renderer for AI report bodies. The app doesn't ship the Tailwind
 * typography plugin, so the report's small set of elements (h2 sections,
 * paragraphs, lists, bold) is styled explicitly via descendant selectors.
 * Width is capped at a comfortable reading measure regardless of how wide
 * the section is.
 *
 * This is PROSE, so it sits on the 16px/24px body rung (notion-spec §3) —
 * not the 14px UI rung. Headings separate by space, never by a rule.
 */
export function ReportMarkdown({ children }: { children: string }) {
  return (
    <div
      className={[
        // The 720px document column (notion-spec-v2 §3) — the same measure as
        // a Notion page body, not an ad-hoc `65ch`.
        "max-w-content text-base leading-6 text-foreground",
        // Notion's H2 block is 24px/31.2px weight 600, and block spacing is
        // 8px of PADDING top and bottom (so two paragraphs sit 16px apart).
        "[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2:first-child]:mt-0",
        "[&_h3]:mt-5 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:leading-6 [&_h3]:font-semibold",
        "[&_p]:py-2 [&_p]:text-pretty",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        "[&_strong]:font-semibold",
        "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
      ].join(" ")}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
