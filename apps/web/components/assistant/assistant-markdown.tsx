import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

/**
 * Markdown at PAGE scale, for the assistant's replies.
 *
 * Deliberately not `ChatMarkdown` (components/chatbots/chat-markdown.tsx):
 * that one is tuned for a chat bubble — tight leading, no heading ramp, a
 * bubble-relative code fill. The assistant owns a reading column, so its
 * persona explicitly allows headings and tables and this renderer has to give
 * them somewhere to land.
 *
 * Type follows DESIGN.md's role ramp: body is CONTENT (16px/relaxed), not UI
 * chrome. Headings step down from 20px so an h1 inside a reply never competes
 * with the page's own masthead.
 */
export function AssistantMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-base leading-7 text-foreground",
        "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
        // Blocks
        "[&_p]:my-3 [&_p]:text-pretty",
        "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-normal",
        "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
        "[&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-medium",
        // Lists
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1 [&_li]:pl-1 [&_li>ul]:my-1 [&_li>ol]:my-1",
        // Inline
        "[&_strong]:font-semibold",
        "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-3 hover:[&_a]:decoration-foreground",
        "[&_code]:rounded-pill [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em]",
        // Fenced code — the one place a horizontal scroller is correct.
        "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-card [&_pre]:bg-muted [&_pre]:p-3.5",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.8125rem] [&_pre_code]:leading-6",
        // Quote + rule
        "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-6 [&_hr]:border-border",
        // Tables. The persona prefers render_ui for record sets, but a small
        // comparison table in prose is legitimate — it must scroll inside
        // itself rather than widening the page.
        "[&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-sm",
        "[&_th]:border-b [&_th]:border-border [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap",
        "[&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top",
        className,
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
