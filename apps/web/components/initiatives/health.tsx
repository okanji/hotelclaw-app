"use client";

import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { StatusBadge } from "@/components/ui/status-badge";
import type { UpdateHealth } from "@/lib/db/types";

/**
 * The DECLARED health vocabulary (a person's call on a status update) —
 * Linear's On track / At risk / Off track. Distinct from the computed pace
 * read in `tracking-shared.tsx` (`HEALTH_META`), which the UI shows beside it.
 */
export const UPDATE_HEALTH_META: Record<
  UpdateHealth,
  { label: string; tone: "success" | "warning" | "danger"; dot: string }
> = {
  on_track: { label: "On track", tone: "success", dot: "bg-success" },
  at_risk: { label: "At risk", tone: "warning", dot: "bg-warning" },
  off_track: { label: "Off track", tone: "danger", dot: "bg-destructive" },
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
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
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
    return <span className={cn("text-sm text-muted-foreground", className)}>No updates</span>;
  const meta = UPDATE_HEALTH_META[health];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-foreground", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden="true" />
      {meta.label}
      {suffix ? <span className="text-faint-foreground">{suffix}</span> : null}
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
    <div role="radiogroup" aria-label="Health" className="flex items-center gap-1">
      {UPDATE_HEALTHS.map((h) => (
        <Chip
          key={h}
          size="sm"
          selected={value === h}
          disabled={disabled}
          onClick={() => onChange(h)}
          role="radio"
          aria-checked={value === h}
        >
          <span
            className={cn("size-2 rounded-full", UPDATE_HEALTH_META[h].dot)}
            aria-hidden="true"
          />
          {UPDATE_HEALTH_META[h].label}
        </Chip>
      ))}
    </div>
  );
}
