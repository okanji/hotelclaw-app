"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ToolCall } from "@/lib/fleet/transcript";
import { AiShimmerLabel } from "@/components/ui/ai-loader";
import { cn } from "@/lib/utils";

/**
 * Grouped, expandable tool trace for AI transcripts — one "Working… /
 * Used N tools" disclosure per assistant turn instead of a flat stack of
 * rows. Auto-expands while the turn is running so the live activity is
 * visible, settles collapsed when it finishes, and stays manually
 * expandable afterwards. Each row opens to the raw tool name + payload,
 * because a bot with this much reach has to stay auditable.
 *
 * Adapted from Beautiful UI's Thinking trace (beautifului.dev,
 * © 2026 Shane Levine, MIT), rebuilt over the eve transcript's ToolCall
 * shape (lib/fleet/transcript.ts).
 */
export function ToolTrace({
  calls,
  labelFor = (call) => call.toolName,
  mono = false,
  className,
}: {
  calls: ToolCall[];
  /** Human label per row; the raw tool name is always in the disclosure. */
  labelFor?: (call: ToolCall) => string;
  /** Mono row labels for transparency surfaces that show raw tool names. */
  mono?: boolean;
  className?: string;
}) {
  const working = calls.some((call) => !call.done);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? working;
  if (calls.length === 0) return null;

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? working))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
      >
        {/* Four-point spark — the "agent at work" glyph. */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          aria-hidden
          className={cn(
            "shrink-0",
            working ? "fill-muted-foreground" : "fill-faint-foreground",
          )}
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <AiShimmerLabel className="whitespace-nowrap">Working…</AiShimmerLabel>
        ) : (
          <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
            {calls.length === 1 ? "Used 1 tool" : `Used ${calls.length} tools`}
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-faint-foreground transition-transform duration-300",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Grid-rows collapse: animatable without measuring content height. */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-1 ml-[7px] border-l border-border pl-4">
            <ul role="list" className="flex flex-col gap-0.5 py-1">
              {calls.map((call, index) => (
                <li
                  key={call.callId}
                  className="ai-fade-up"
                  style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
                >
                  <details className="group">
                    <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent">
                      {call.done ? (
                        <Check
                          className="size-3.5 shrink-0 text-faint-foreground"
                          aria-hidden
                        />
                      ) : (
                        <span
                          className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          mono ? "font-mono text-xs" : "text-sm",
                          call.done ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {labelFor(call)}
                      </span>
                    </summary>
                    <div className="mt-1 mb-1.5 ml-[22px] flex flex-col gap-1.5">
                      <code className="font-mono text-xs text-faint-foreground">
                        {call.toolName}
                      </code>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs leading-5">
                        {JSON.stringify(
                          { input: call.input, output: call.output },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
