import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

/**
 * Markdown renderer for guest-bot reply bubbles. Bot replies may now use
 * light markdown (bullets, numbered lists, **bold**, inline code, links) —
 * see the guest-bot system prompt. Text colour is inherited from the bubble
 * (this component never sets a colour) so the same renderer works on the
 * white guest bubble and the dark test console. Spacing is tight to suit a
 * chat bubble; links open in a new tab.
 */
export function ChatMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
        "[&_p]:my-1.5 [&_p]:text-pretty",
        "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-4.5 [&_li]:my-0.5 [&_li]:pl-0.5",
        "[&_strong]:font-semibold",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] dark:[&_code]:bg-white/15",
        "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
        className,
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
