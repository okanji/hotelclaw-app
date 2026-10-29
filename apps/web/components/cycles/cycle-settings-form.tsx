"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { CycleSettingsRow } from "@/lib/cycles/types";
import { saveCycleSettings } from "./actions";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The cadence form — shared by the "Enable cycles" empty state and the
 * settings popover on the cycles page. Saving materialises the cadence
 * immediately (the action calls `ensureCycles`), then refreshes the server
 * page and the shared `["cycles", propertyId]` cache the sidebar reads.
 */
export function CycleSettingsForm({
  propertyId,
  spaceId,
  settings,
  onSaved,
}: {
  propertyId: string;
  /** null = the property-wide cadence. */
  spaceId: string | null;
  /** Existing cadence, or null to create one. */
  settings: CycleSettingsRow | null;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [durationWeeks, setDurationWeeks] = useState(
    settings?.duration_weeks ?? 1,
  );
  const [startWeekday, setStartWeekday] = useState(
    settings?.start_weekday ?? 1,
  );
  const [upcomingCount, setUpcomingCount] = useState(
    settings?.upcoming_count ?? 2,
  );
  const [autoRollover, setAutoRollover] = useState(
    settings?.auto_rollover ?? true,
  );
  const creating = !settings?.enabled;

  function save(enabled: boolean) {
    startTransition(async () => {
      const res = await saveCycleSettings({
        propertyId,
        spaceId,
        enabled,
        durationWeeks,
        startWeekday,
        upcomingCount,
        autoRollover,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        !enabled ? "Cycles turned off" : creating ? "Cycles enabled" : "Cycle settings saved",
      );
      void qc.invalidateQueries({ queryKey: ["cycles", propertyId] });
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <form
      className="flex flex-col gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
    >
      <Field label="Cycle length">
        <NativeSelect
          value={durationWeeks}
          onChange={(e) => setDurationWeeks(Number(e.target.value))}
          disabled={pending}
        >
          {[1, 2, 3, 4, 6, 8].map((w) => (
            <option key={w} value={w}>
              {w === 1 ? "1 week" : `${w} weeks`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Starts on">
        <NativeSelect
          value={startWeekday}
          onChange={(e) => setStartWeekday(Number(e.target.value))}
          disabled={pending}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Plan ahead">
        <NativeSelect
          value={upcomingCount}
          onChange={(e) => setUpcomingCount(Number(e.target.value))}
          disabled={pending}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 upcoming cycle" : `${n} upcoming cycles`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <label className="flex items-start justify-between gap-3 py-1">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">Roll over open work</span>
          <span className="text-xs text-faint-foreground">
            Unfinished tasks move to the next cycle when one ends.
          </span>
        </span>
        <Switch
          checked={autoRollover}
          onCheckedChange={setAutoRollover}
          disabled={pending}
          aria-label="Roll over open work"
        />
      </label>
      <div className="flex items-center justify-between gap-2 pt-1">
        {creating ? (
          <span />
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pending}
            onClick={() => save(false)}
          >
            Turn off cycles
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {creating ? "Enable cycles" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
