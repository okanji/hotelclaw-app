"use client";

import { Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared chat rendering primitives for the bot surfaces — the sandbox test
 * console, the staff conversation transcript, and the playground compare
 * panes. These three previously hand-rolled bubbles/chips with drifting
 * radii and type sizes; render through this module instead.
 */

export function ChatBubble({
  tone = "outline",
  compact = false,
  preWrap = true,
  className,
  children,
}: {
  /**
   * start = incoming, end = outgoing. Kept in the API (every call site passes
   * it) but purely semantic now — the Notion radius scale has one clickable
   * rung, so there is no corner notch to drive.
   */
  side: "start" | "end";
  tone?: "solid" | "outline" | "soft" | "staff";
  /** Playground-density bubble (smaller radius, text-xs). */
  compact?: boolean;
  /** Disable for markdown content that manages its own wrapping. */
  preWrap?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "leading-relaxed",
        preWrap && "whitespace-pre-wrap",
        // One radius rung (6px). The old build notched the bottom corner to
        // fake a speech tail off a 12/16px base — with the two-rung scale
        // there is no delta left to notch with, so `side` now only drives
        // alignment at the call site.
        compact ? "rounded-md px-2.5 py-1.5 text-xs" : "rounded-md px-3 py-2 text-sm",
        tone === "solid" && "bg-foreground text-background",
        tone === "outline" && "bg-background shadow-ring",
        tone === "soft" && "bg-foreground/5",
        tone === "staff" && "bg-info/10 text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolCallChip({
  name,
  input,
}: {
  name: string;
  input?: unknown;
}) {
  return (
    <span
      title={input !== undefined ? JSON.stringify(input, null, 2) : undefined}
      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
    >
      <Wrench className="size-3 shrink-0" />
      {name}
    </span>
  );
}

export function ToolCallList({
  calls,
  className,
}: {
  calls: { name: string; input?: unknown }[];
  className?: string;
}) {
  if (calls.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {calls.map((tc, i) => (
        <ToolCallChip key={i} name={tc.name} input={tc.input} />
      ))}
    </div>
  );
}

export function ThinkingRow({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center text-xs text-muted-foreground",
        compact ? "gap-1.5" : "gap-2 px-1 py-1",
      )}
    >
      <Loader2
        className={cn("animate-spin", compact ? "size-3" : "size-3.5")}
      />
      Thinking…
    </div>
  );
}
