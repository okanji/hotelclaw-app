import type { CycleSettingsRow } from "@/lib/cycles/types";

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve `?space=` to a cadence scope: a team id, `property` for the
 * property-wide cadence, or — when absent/garbage — the first enabled
 * cadence (property-wide first), falling back to property-wide.
 */
export function resolveCycleScope(
  param: string | undefined,
  settings: Pick<CycleSettingsRow, "space_id" | "enabled">[],
): string | null {
  if (param === "property") return null;
  if (param && UUID_RX.test(param)) return param;
  const enabled = settings.filter((s) => s.enabled);
  return (
    enabled.find((s) => s.space_id === null)?.space_id ??
    enabled[0]?.space_id ??
    null
  );
}
