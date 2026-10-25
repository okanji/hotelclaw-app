import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCycles } from "@/lib/cycles/ensure";
import { currentCycleOf } from "@/lib/cycles/plan";
import { cyclesHref } from "@/lib/query/cycle-queries";
import { resolveCycleScope } from "../scope";

export const dynamic = "force-dynamic";

/**
 * `/cycles/current?space=` — the sidebar's "Current" entry. Materialises
 * (so a cycle that ended overnight has already rolled over) and redirects to
 * the cycle covering today, or to the cadence's list when there is none.
 */
export default async function CurrentCyclePage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ space?: string }>;
}) {
  const { propertyId } = await params;
  const { space } = await searchParams;
  const supabase = await createClient();

  const { data: allSettings, error } = await supabase
    .from("cycle_settings")
    .select("space_id, enabled")
    .eq("property_id", propertyId);
  if (error) notFound();
  const spaceId = resolveCycleScope(space, allSettings ?? []);

  const { cycles, today } = await ensureCycles(supabase, propertyId, spaceId);
  const current = currentCycleOf(cycles, today);
  redirect(
    current
      ? `/p/${propertyId}/cycles/${current.id}`
      : cyclesHref(propertyId, spaceId),
  );
}
