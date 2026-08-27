"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  Briefcase,
  Minimize2,
  Smile,
  SpellCheck,
  Undo2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AiShimmerLabel } from "@/components/ui/ai-loader";
import { cn } from "@/lib/utils";

/**
 * Contextual AI actions for a plain-textarea selection — select some text
 * and a quiet chip bar appears offering one-tap rewrites (improve, shorten,
 * grammar, tone). The rewrite replaces only the selected range; a one-step
 * Undo chip restores the pre-rewrite draft until the next manual edit.
 *
 * Adapted from Beautiful UI's Selection Actions (beautifului.dev, © 2026
 * Shane Levine, MIT). Their bar floats under a DOM Range; a textarea has no
 * ranges, so this bar docks above the field instead — same actions, honest
 * mechanics.
 */

const ACTIONS: { id: string; label: string; icon: LucideIcon; instruction: string }[] = [
  {
    id: "improve",
    label: "Improve",
    icon: Wand2,
    instruction: "Improve the writing: clearer, tighter, better flow. Keep the meaning and all facts.",
  },
  {
    id: "shorten",
    label: "Shorten",
    icon: Minimize2,
    instruction: "Make this significantly shorter while keeping every load-bearing fact.",
  },
  {
    id: "grammar",
    label: "Fix grammar",
    icon: SpellCheck,
    instruction: "Fix spelling, grammar, and punctuation only. Change nothing else.",
  },
  {
    id: "professional",
    label: "Professional",
    icon: Briefcase,
    instruction: "Rewrite in a professional, neutral tone suitable for a staff handover.",
  },
  {
    id: "friendly",
    label: "Friendly",
    icon: Smile,
    instruction: "Rewrite in a warmer, friendlier tone. Keep it concise and factual.",
  },
];

export function SelectionActionsBar({
  textareaRef,
  value,
  onChange,
  rewrite,
  disabled,
  className,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** Rewrites `selection` per `instruction`; before/after are context only. */
  rewrite: (args: {
    selection: string;
    before: string;
    after: string;
    instruction: string;
  }) => Promise<string>;
  disabled?: boolean;
  className?: string;
}) {
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [undoValue, setUndoValue] = useState<string | null>(null);

  // Selection tracked in state so it survives the focus loss of clicking a
  // chip (the browser clears the visual selection; the numbers don't lie).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const read = () => {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      setRange(end - start >= 4 ? { start, end } : null);
    };
    el.addEventListener("select", read);
    el.addEventListener("keyup", read);
    el.addEventListener("mouseup", read);
    return () => {
      el.removeEventListener("select", read);
      el.removeEventListener("keyup", read);
      el.removeEventListener("mouseup", read);
    };
  }, [textareaRef]);

  // A range that outlived the text it pointed at is stale — derived at
  // render rather than synced in an effect (react-hooks/set-state-in-effect).
  const activeRange = range && range.end <= value.length ? range : null;

  const apply = useCallback(
    async (actionId: string, instruction: string) => {
      const el = textareaRef.current;
      const range = activeRange;
      if (!range || !el || busyAction) return;
      const selection = value.slice(range.start, range.end);
      if (!selection.trim()) return;
      setBusyAction(actionId);
      try {
        const result = await rewrite({
          selection,
          before: value.slice(0, range.start),
          after: value.slice(range.end),
          instruction,
        });
        const trimmed = result.trim();
        if (!trimmed) throw new Error("The rewrite came back empty.");
        setUndoValue(value);
        const next = value.slice(0, range.start) + trimmed + value.slice(range.end);
        onChange(next);
        // Re-select the rewritten span so a follow-up action can chain.
        const newEnd = range.start + trimmed.length;
        setRange({ start: range.start, end: newEnd });
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(range.start, newEnd);
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't rewrite that",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [activeRange, busyAction, onChange, rewrite, textareaRef, value],
  );

  const visible = (activeRange !== null || undoValue !== null) && !disabled;
  if (!visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Rewrite selection"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md bg-muted px-1.5 py-1",
        className,
      )}
    >
      {busyAction ? (
        <AiShimmerLabel className="px-1.5 text-xs">Rewriting…</AiShimmerLabel>
      ) : activeRange ? (
        ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => void apply(action.id, action.instruction)}
            className="flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-secondary-ink transition-colors hover:bg-accent"
          >
            <action.icon className="size-3 shrink-0 text-faint-foreground" aria-hidden />
            {action.label}
          </button>
        ))
      ) : (
        <span className="px-1.5 text-xs text-faint-foreground">
          Select text to rewrite it
        </span>
      )}
      {undoValue !== null && !busyAction ? (
        <button
          type="button"
          onClick={() => {
            onChange(undoValue);
            setUndoValue(null);
            setRange(null);
          }}
          className="ml-auto flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-secondary-ink transition-colors hover:bg-accent"
        >
          <Undo2 className="size-3 shrink-0 text-faint-foreground" aria-hidden />
          Undo rewrite
        </button>
      ) : null}
    </div>
  );
}
