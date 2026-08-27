"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Wrench } from "lucide-react";
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

/**
 * One line describing a sandbox-simulated side effect
 * (`{simulated: true, would_*: {...}}` outputs from the test console),
 * so "nothing was written" is visible without expanding the chip.
 */
function simulatedOutcomeLine(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const o = output as Record<string, unknown>;
  if (o.simulated !== true) return null;
  const key = Object.keys(o).find((k) => k.startsWith("would_"));
  const payload =
    key && typeof o[key] === "object" && o[key] !== null
      ? (o[key] as Record<string, unknown>)
      : undefined;
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  switch (key) {
    case "would_create":
      return `Would create ticket: ${text(payload?.title) ?? "(untitled)"}`;
    case "would_escalate":
      return `Would hand off to staff: ${text(payload?.summary) ?? "(no summary)"}`;
    case "would_book": {
      const service = text(payload?.service);
      const when = text(payload?.starts_at);
      return `Would book${service ? ` ${service}` : ""}${when ? ` · ${when}` : ""}`;
    }
    default:
      return key
        ? `Simulated: ${key.replace(/^would_/, "would ").replace(/_/g, " ")}`
        : "Simulated — no side effect ran";
  }
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    text = String(value);
  }
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-xs font-medium text-faint-foreground">{label}</p>
      <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}

/**
 * A tool call as a compact chip that expands on click (keyboard accessible —
 * it's a real button with aria-expanded) to show the call's input, and its
 * output when the surface has one. The staff transcript doesn't persist
 * outputs, so there the panel shows input only.
 */
export function ToolCallChip({
  name,
  input,
  output,
}: {
  name: string;
  input?: unknown;
  output?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const simulated = simulatedOutcomeLine(output);
  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group/tool flex w-fit max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Wrench className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 opacity-50 transition-transform group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100",
            open && "rotate-180 opacity-100",
          )}
        />
      </button>
      {simulated ? (
        <p className="mt-0.5 pl-0.5 text-xs text-muted-foreground italic">
          {simulated}
        </p>
      ) : null}
      {open ? (
        <div className="mt-1 space-y-2 rounded-md bg-muted p-2 shadow-ring">
          <JsonBlock label="Input" value={input} />
          {output !== undefined ? (
            <JsonBlock label="Output" value={output} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolCallList({
  calls,
  className,
}: {
  calls: { name: string; input?: unknown; output?: unknown }[];
  className?: string;
}) {
  if (calls.length === 0) return null;
  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      {calls.map((tc, i) => (
        <ToolCallChip key={i} name={tc.name} input={tc.input} output={tc.output} />
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
