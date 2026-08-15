"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The message box. One component for both places it appears — centred on the
 * empty state (Claude's "Write a message…" card) and pinned to the bottom of
 * a running conversation — because two composers that drift apart is exactly
 * how a surface starts feeling assembled rather than designed.
 *
 * Auto-grows to a cap, then scrolls internally: a pasted brief should be
 * visible while you edit it, but must never push the transcript off screen.
 */
export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Write a message…",
  autoFocus = false,
  size = "inline",
  trailing,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * `inline` sits under a running conversation and should stay out of the
   * way. `hero` is the START of something — the home screen and a project's
   * page — where the composer IS the primary action and has to read that way
   * at a glance. The first cut used one size everywhere and the project
   * composer ended up the same height as the cards beside it, so it scanned
   * as another card rather than as the place you type.
   */
  size?: "inline" | "hero";
  /** Chips shown on the composer's bottom row (project, scope hints). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow from the resting height. Reset to `auto` first or the box can
  // only ever get taller; floor at the resting height so a hero composer
  // doesn't collapse to one line the moment you type.
  const restingHeight = size === "hero" ? 88 : 24;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, restingHeight), 320)}px`;
  }, [value, restingHeight]);

  const canSend = value.trim().length > 0 && !busy && !disabled;

  return (
    <form
      className={cn(
        "rounded-card bg-card shadow-composer transition-shadow focus-within:shadow-composer-focus",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        rows={1}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message the assistant"
        className={cn(
          "block max-h-80 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-6",
          "placeholder:text-faint-foreground focus-visible:outline-none disabled:opacity-60",
          size === "hero" && "min-h-22",
        )}
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{trailing}</div>
        {busy && onStop ? (
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend}
            aria-label="Send message"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
