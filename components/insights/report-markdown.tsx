"use client";

import ReactMarkdown from "react-markdown";

/**
 * Markdown renderer for AI report bodies. The app doesn't ship the Tailwind
 * typography plugin, so the report's small set of elements (h2 sections,
 * paragraphs, lists, bold) is styled explicitly via descendant selectors.
 * Width is capped at a comfortable reading measure regardless of how wide
 * the section is.
 */
export function ReportMarkdown({ children }: { children: string }) {
  return (
    <div
      className={[
        "max-w-[65ch] text-[0.8125rem] leading-relaxed text-foreground",
        "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border/40 [&_h2]:pb-1.5 [&_h2]:text-[0.9375rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2:first-child]:mt-0",
        "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-[0.875rem] [&_h3]:font-semibold",
        "[&_p]:my-2 [&_p]:text-pretty",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        "[&_strong]:font-semibold",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono",
      ].join(" ")}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
