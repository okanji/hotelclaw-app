import type { LucideIcon } from "lucide-react";

/**
 * gr8r-studio's `ic(name, size)` (src/core/icons.js): a Lucide glyph at
 * stroke 1.8 carrying the `.i` class gr8r's CSS keys on (`.sitem .i`,
 * `svg.i`, `.chev`…). Use the Lucide component gr8r names (`house` →
 * `House`, `circle-check` → `CircleCheck`).
 */
export function Gi({
  icon: Icon,
  size = 16,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      className={className ? `i ${className}` : "i"}
      size={size}
      strokeWidth={1.8}
      aria-hidden="true"
    />
  );
}
