"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ScrubField — a compact labeled number field (Figma-style inspector input).
 *
 *   · Drag the label horizontally to scrub the value (pointer capture; the
 *     label shows a ↔ col-resize cursor on hover).
 *   · ↑/↓ arrows step the value from the label or the input (Shift = ×10).
 *   · Typing works normally; the draft commits on blur or Enter, Escape
 *     reverts. Everything clamps to [min, max] and snaps to `step`.
 *
 * The bounds are discoverable: both the label and the input carry a
 * "Drag to adjust · min–max" title, and the slider role exposes
 * aria-valuemin/max. Fully controlled — every change flows through
 * `onChange`, nothing is stored internally beyond the in-progress draft.
 */
export function ScrubField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const drag = React.useRef<{ x: number; v: number } | null>(null);
  // Draft holds in-progress typing; null means "mirror the prop".
  const [draft, setDraft] = React.useState<string | null>(null);

  const clamp = React.useCallback(
    (v: number) => {
      const snapped = Math.round(v / step) * step;
      // Trim float residue from fractional steps before clamping.
      return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
    },
    [min, max, step],
  );

  function stepBy(direction: 1 | -1, shiftKey: boolean) {
    const parsed = draft === null ? value : Number(draft);
    const base = Number.isFinite(parsed) ? parsed : value;
    setDraft(null);
    onChange(clamp(base + direction * step * (shiftKey ? 10 : 1)));
  }

  function commitDraft() {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
    setDraft(null);
  }

  const hint = `Drag to adjust · ${min}–${max}${suffix ? ` ${suffix}` : ""}`;

  return (
    <div className={cn("space-y-1", disabled && "opacity-50", className)}>
      <span
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        title={disabled ? undefined : hint}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, v: value };
          setDraft(null);
        }}
        onPointerMove={(e) => {
          if (!drag.current || disabled) return;
          onChange(
            clamp(drag.current.v + ((e.clientX - drag.current.x) / 2) * step),
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            stepBy(1, e.shiftKey);
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            stepBy(-1, e.shiftKey);
          }
        }}
        className={cn(
          "flex w-fit items-center text-sm leading-none font-medium select-none",
          "rounded-md focus-visible:shadow-focus focus-visible:outline-none",
          !disabled && "cursor-col-resize touch-none",
        )}
      >
        {label}
      </span>
      <div className="relative">
        <input
          inputMode="decimal"
          value={draft ?? String(value)}
          disabled={disabled}
          aria-label={`${label} value`}
          title={disabled ? undefined : hint}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Escape") {
              setDraft(null);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              stepBy(1, e.shiftKey);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              stepBy(-1, e.shiftKey);
            }
          }}
          className={cn(
            "h-8 w-full min-w-0 rounded-md bg-transparent px-2 text-sm tabular-nums shadow-ring outline-none",
            "transition-[background-color,box-shadow] focus-visible:shadow-focus",
            "placeholder:text-faint-foreground disabled:pointer-events-none disabled:cursor-not-allowed dark:bg-muted",
            suffix && "pr-7",
          )}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-faint-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}
