import { cn } from "@/lib/utils";

/**
 * Small SVG status ring for workflow runs + steps, in the TaskRows grammar:
 * an indeterminate stroke sweep while running, a full success-tinted ring
 * with a check once succeeded, a destructive ring with an x on failure, and
 * a muted dashed ring for the not-started / ended-early states (queued,
 * waiting, cancelled, skipped, filtered).
 *
 * Optional children (e.g. a step ordinal) render in the center for every
 * non-terminal state; the terminal check/x replaces them.
 */
export function RunStatusRing({
  status,
  size = 16,
  className,
  children,
}: {
  status: string;
  /** Outer box in px — 16 for list rows, 22 for inspector step rows. */
  size?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const strokeWidth = size >= 20 ? 2 : 1.75;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  const glyph = Math.round(size * 0.55);

  const running = status === "running";
  const succeeded = status === "succeeded";
  const failed = status === "failed";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className={cn("absolute inset-0", running && "animate-spin")}
      >
        {running ? (
          <>
            <circle
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-border"
            />
            <circle
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${c * 0.3} ${c}`}
              className="text-info"
            />
          </>
        ) : succeeded || failed ? (
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className={succeeded ? "text-success" : "text-destructive"}
          />
        ) : (
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray="2.5 3"
            className="text-faint-foreground"
          />
        )}
      </svg>
      {succeeded ? (
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative text-success"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : failed ? (
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          className="relative text-destructive"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      ) : children ? (
        <span className="relative font-mono text-xs font-medium text-muted-foreground tabular-nums">
          {children}
        </span>
      ) : null}
    </span>
  );
}
