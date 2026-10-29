import { cn } from "@/lib/utils";

/** A small points chip — the estimate, as a gr8r `.badge`. */
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
        "badge gray num shrink-0 justify-center",
        className,
      )}
    >
      {estimate}
    </span>
  );
}
