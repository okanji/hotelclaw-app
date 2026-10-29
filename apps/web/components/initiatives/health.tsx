"use client";

import { cn } from "@/lib/utils";
import type { UpdateHealth } from "@/lib/db/types";

/**
 * The DECLARED health vocabulary (a person's call on a status update) —
 * Linear's On track / At risk / Off track. Distinct from the computed pace
 * read in `tracking-shared.tsx` (`HEALTH_META`), which the UI shows beside it.
 * Rendered in gr8r's vocabulary: `.badge green|amber|red`, a dot in the same
 * `--g8-*` ink, and a `.seg` picker.
 */
export const UPDATE_HEALTH_META: Record<
  UpdateHealth,
  {
    label: string;
    tone: "success" | "warning" | "danger";
    dot: string;
    /** gr8r `.badge` modifier. */
    badge: "green" | "amber" | "red";
    /** gr8r ink for the dot. */
    color: string;
  }
> = {
  on_track: { label: "On track", tone: "success", dot: "bg-success", badge: "green", color: "var(--g8-green)" },
  at_risk: { label: "At risk", tone: "warning", dot: "bg-warning", badge: "amber", color: "var(--g8-amber)" },
  off_track: { label: "Off track", tone: "danger", dot: "bg-destructive", badge: "red", color: "var(--g8-red)" },
};

export const UPDATE_HEALTHS: UpdateHealth[] = ["on_track", "at_risk", "off_track"];

export function UpdateHealthBadge({
  health,
  className,
}: {
  health: UpdateHealth;
  className?: string;
}) {
  const meta = UPDATE_HEALTH_META[health];
  return (
    <span className={cn(`badge ${meta.badge}`, className)}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}

/** Dot + label, for dense table cells and rail rows. */
export function HealthDot({
  health,
  suffix,
  className,
}: {
  health: UpdateHealth | null;
  /** Trailing faint qualifier, e.g. "(roll-up)". */
  suffix?: string;
  className?: string;
}) {
  if (!health)
    return <span className={cn("faint", className)}>No updates</span>;
  const meta = UPDATE_HEALTH_META[health];
  return (
    <span className={cn("row", className)} style={{ gap: 6, display: "inline-flex" }}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: meta.color }}
      />
      {meta.label}
      {suffix ? <span className="faint">{suffix}</span> : null}
    </span>
  );
}

/** Three chips — the composer's health call. */
export function HealthPicker({
  value,
  onChange,
  disabled,
}: {
  value: UpdateHealth;
  onChange: (h: UpdateHealth) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Health" className="seg">
      {UPDATE_HEALTHS.map((h) => (
        <button
          key={h}
          type="button"
          className={value === h ? "on" : ""}
          disabled={disabled}
          onClick={() => onChange(h)}
          role="radio"
          aria-checked={value === h}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: UPDATE_HEALTH_META[h].color,
              display: "inline-block",
              marginRight: 5,
            }}
          />
          {UPDATE_HEALTH_META[h].label}
        </button>
      ))}
    </div>
  );
}
