import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCycles } from "@/lib/cycles/ensure";
import { loadCycleData } from "@/lib/cycles/server";
import { cyclePhase } from "@/lib/cycles/plan";
import type { CycleSettingsRow } from "@/lib/cycles/types";
import { CyclesView } from "@/components/cycles/cycles-view";
import { resolveCycleScope } from "./scope";

export const dynamic = "force-dynamic";

/** Finished cycles shown (and replayed) on the list — older ones stay reachable via prev/next. */
const PAST_SHOWN = 12;

/**
 * Cycles — one cadence's timeline (`?space=<team id>` or `?space=property`).
 * Server-rendered like Meetings: loading the page IS the lazy cron
 * (`ensureCycles` materialises the next cycle and rolls ended ones over),
 * then tasks + activity_log for the shown cycles go to the client, which
 * replays the burn-up from them.
 */
export default async function CyclesPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ space?: string }>;
}) {
  const { propertyId } = await params;
  const { space } = await searchParams;
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .is("archived_at", null)
    .maybeSingle();
  if (!property) notFound();

  const { data: allSettings } = await supabase
    .from("cycle_settings")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });
  const settingsList = (allSettings ?? []) as CycleSettingsRow[];
  const spaceId = resolveCycleScope(space, settingsList);

  const { settings, cycles, today, timeZone } = await ensureCycles(
    supabase,
    propertyId,
    spaceId,
  );

  const past = cycles
    .filter((c) => cyclePhase(c, today) === "past")
    .sort((a, b) => (a.ends_on < b.ends_on ? 1 : -1))
    .slice(0, PAST_SHOWN);
  const shown = [
    ...cycles.filter((c) => cyclePhase(c, today) !== "past"),
    ...past,
  ];
  const { tasks, events } = await loadCycleData(supabase, propertyId, shown);

  return (
    <CyclesView
      propertyId={propertyId}
      spaceId={spaceId}
      settings={settings}
      allSettings={settingsList.map((s) =>
        s.space_id === spaceId && settings ? settings : s,
      )}
      cycles={shown}
      tasks={tasks}
      events={events}
      today={today}
      timeZone={timeZone}
    />
  );
}
