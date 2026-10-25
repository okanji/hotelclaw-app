import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCycles } from "@/lib/cycles/ensure";
import { loadCycleData } from "@/lib/cycles/server";
import { CycleDetail } from "@/components/cycles/cycle-detail";

export const dynamic = "force-dynamic";

/**
 * One cycle: tasks by status beside the progress / burn-up / breakdown
 * panel. Runs `ensureCycles` for the cycle's cadence first so a cycle that
 * just ended shows its rolled-over state, not a stale one.
 */
export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; cycleId: string }>;
}) {
  const { propertyId, cycleId } = await params;
  const supabase = await createClient();

  // RLS returns nothing to non-members and the property fence stops a
  // cross-property id — both are a 404.
  const { data: cycle } = await supabase
    .from("cycles")
    .select("id, space_id")
    .eq("id", cycleId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!cycle) notFound();

  const [{ cycles, today, timeZone }, space] = await Promise.all([
    ensureCycles(supabase, propertyId, cycle.space_id),
    cycle.space_id
      ? supabase
          .from("spaces")
          .select("name")
          .eq("id", cycle.space_id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  const current = cycles.find((c) => c.id === cycleId);
  if (!current) notFound();

  const { tasks, events } = await loadCycleData(supabase, propertyId, [current]);

  return (
    <CycleDetail
      propertyId={propertyId}
      cycle={current}
      siblings={cycles}
      tasks={tasks}
      events={events}
      today={today}
      timeZone={timeZone}
      scopeName={cycle.space_id ? (space?.name ?? "Team") : "Whole property"}
    />
  );
}
