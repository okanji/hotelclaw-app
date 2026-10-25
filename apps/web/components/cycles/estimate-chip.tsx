import { cn } from "@/lib/utils";

/** A small points chip — the estimate as Linear draws it. */
export function EstimateChip({
  estimate,
  className,
}: {
  estimate: number | null | undefined;
  className?: string;
}) {
  if (estimate == null) return null;
  return (
    <span
      title={`Estimate: ${estimate} ${estimate === 1 ? "point" : "points"}`}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill bg-pill-neutral px-1 text-xs font-medium text-pill-neutral-ink tabular-nums",
        className,
      )}
    >
      {estimate}
    </span>
  );
}
