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
  side,
  tone = "outline",
  compact = false,
  preWrap = true,
  className,
  children,
}: {
  /** Which bottom corner gets the notch — start = incoming, end = outgoing. */
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
        compact
          ? "rounded-xl px-2.5 py-1.5 text-xs"
          : "rounded-2xl px-3 py-2 text-sm",
        side === "end"
          ? compact
            ? "rounded-br-sm"
            : "rounded-br-md"
          : compact
            ? "rounded-bl-sm"
            : "rounded-bl-md",
        tone === "solid" && "bg-foreground text-background",
        tone === "outline" && "border border-border/60 bg-background",
        tone === "soft" && "bg-foreground/5",
        tone === "staff" && "bg-sky-500/10 text-foreground",
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
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground"
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
