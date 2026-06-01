"use client";

import { Input } from "@/components/ui/input";
import type { WorkflowSpec } from "@/lib/workflows/spec";

/** Cron / one-shot schedule fields on the trigger node (not optional filters). */
export function ScheduleTriggerConfig({
  trigger,
  onChange,
}: {
  trigger: WorkflowSpec["trigger"];
  onChange: (schedule: NonNullable<WorkflowSpec["trigger"]["schedule"]>) => void;
}) {
  const schedule = trigger.schedule ?? {};
  const isCron = trigger.event_type === "schedule.cron";
  const isAtTime = trigger.event_type === "schedule.at_time";

  if (!isCron && !isAtTime) return null;

  function patch(next: Partial<NonNullable<WorkflowSpec["trigger"]["schedule"]>>) {
    onChange({ ...schedule, ...next });
  }

  return (
    <div className="space-y-3">
      {isCron ? (
        <>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Cron expression
            </span>
            <Input
              id="trigger-schedule-cron"
              value={schedule.cron ?? ""}
              onChange={(e) => patch({ cron: e.target.value || undefined })}
              placeholder="0 9 * * 1"
              className="font-mono text-[13px]"
            />
            <span className="block text-[12px] text-muted-foreground">
              Standard 5-field cron — e.g.{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">0 9 * * 1</code> for
              Mondays at 9:00.
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Timezone
            </span>
            <Input
              id="trigger-schedule-timezone"
              value={schedule.timezone ?? ""}
              onChange={(e) => patch({ timezone: e.target.value || undefined })}
              placeholder="America/New_York"
              className="text-[13px]"
            />
            <span className="block text-[12px] text-muted-foreground">
              IANA timezone. Defaults to UTC when empty.
            </span>
          </label>
        </>
      ) : null}
      {isAtTime ? (
        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Run at
          </span>
          <Input
            id="trigger-schedule-at"
            type="datetime-local"
            value={isoToLocalInput(schedule.at)}
            onChange={(e) => patch({ at: localInputToIso(e.target.value) })}
            className="text-[13px]"
          />
          <span className="block text-[12px] text-muted-foreground">
            One-shot run at this local datetime.
          </span>
        </label>
      ) : null}
    </div>
  );
}

function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
