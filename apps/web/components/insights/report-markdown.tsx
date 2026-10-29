"use client";

import ReactMarkdown from "react-markdown";

/**
 * Markdown renderer for AI report bodies. The app doesn't ship the Tailwind
 * typography plugin, so the report's small set of elements (h2 sections,
 * paragraphs, lists, bold) is styled explicitly via descendant selectors.
 * Width is capped at a comfortable reading measure regardless of how wide
 * the section is.
 *
 * gr8r port: the type follows gr8r's ramp — body at `--fs-md` (14.5px),
 * section heads at `--fs-lg`, inline code on `--surface-2`. Headings
 * separate by space, never by a rule.
 */
export function ReportMarkdown({ children }: { children: string }) {
  return (
    <div
      className={[
        // The 720px document column (notion-spec-v2 §3) — the same measure as
        // a Notion page body, not an ad-hoc `65ch`.
        "max-w-content text-[length:var(--g8-fs-md)] leading-[1.6] text-(--g8-text)",
        // Notion's H2 block is 24px/31.2px weight 600, and block spacing is
        // 8px of PADDING top and bottom (so two paragraphs sit 16px apart).
        "[&_h2]:mt-6 [&_h2]:mb-1.5 [&_h2]:text-[length:var(--g8-fs-lg)] [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2:first-child]:mt-0",
        "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-[length:var(--g8-fs-md)] [&_h3]:font-semibold",
        "[&_p]:py-1.5 [&_p]:text-pretty [&_p]:text-(--g8-text-2)",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:text-(--g8-text-2)",
        "[&_strong]:font-semibold [&_strong]:text-(--g8-text)",
        "[&_code]:rounded-[var(--g8-r-xs)] [&_code]:bg-(--g8-surface-2) [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[length:var(--g8-fs-sm)]",
      ].join(" ")}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
