"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Clock, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_SCHEDULE,
  SCHEDULE_FREQUENCIES,
  describeSchedule,
  type ProjectScheduleConfig,
  type ScheduleFrequency,
} from "@/lib/assistant/schedule-automation";
import { cn } from "@/lib/utils";
import {
  deleteProjectSchedule,
  getProjectSchedules,
  saveProjectSchedule,
  setProjectScheduleEnabled,
  type ProjectSchedule,
} from "./schedule-actions";

/**
 * The Scheduled card on a project — "run the assistant on a repeating
 * schedule; results land here as conversations you can reply to".
 *
 * Each schedule is a real workflow. That is a feature, not an implementation
 * detail, so the card says so and links to the builder: someone who wants a
 * second step (post it to a channel, open a task) graduates into Workflows
 * instead of hitting a ceiling. A schedule that HAS been customized there
 * comes back with `config: null` and renders read-only.
 */

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Weekly",
  monthly: "Monthly",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ScheduledCard({
  propertyId,
  projectId,
  projectName,
  /** Property timezone — the sensible default for a new schedule. */
  timezone,
}: {
  propertyId: string;
  projectId: string;
  projectName: string;
  timezone: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProjectSchedule | "new" | null>(null);

  // react-query, not a fetch-on-mount effect: same as every other data-backed
  // surface in the app, and it gives the mutations below a cache to write
  // straight into (every action returns the fresh list).
  const queryKey = ["assistant-schedules", propertyId, projectId] as const;
  const { data: schedules, isPending } = useQuery({
    queryKey,
    queryFn: async (): Promise<ProjectSchedule[]> => {
      const result = await getProjectSchedules({ propertyId, projectId });
      if ("error" in result) throw new Error(result.error);
      return result.schedules;
    },
    staleTime: 30_000,
  });

  async function toggle(schedule: ProjectSchedule, enabled: boolean) {
    // Optimistic — the switch must not lag behind the thumb.
    qc.setQueryData<ProjectSchedule[]>(queryKey, (prev) =>
      prev?.map((s) => (s.workflowId === schedule.workflowId ? { ...s, enabled } : s)),
    );
    const result = await setProjectScheduleEnabled({
      propertyId,
      projectId,
      workflowId: schedule.workflowId,
      enabled,
    });
    if ("error" in result) {
      toast.error(result.error);
      void qc.invalidateQueries({ queryKey });
      return;
    }
    qc.setQueryData(queryKey, result.schedules);
  }

  async function remove(schedule: ProjectSchedule) {
    const result = await deleteProjectSchedule({
      propertyId,
      projectId,
      workflowId: schedule.workflowId,
    });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    qc.setQueryData(queryKey, result.schedules);
    toast.success("Schedule removed");
  }

  return (
    <section className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Scheduled</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add a schedule"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {isPending ? (
        <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
      ) : !schedules || schedules.length === 0 ? (
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          Run the assistant on a repeating schedule — a Monday review, a nightly
          check. Each run lands here as a conversation you can open and reply to.
        </p>
      ) : (
        <ul role="list" className="mt-2 flex flex-col gap-1">
          {schedules.map((schedule) => (
            <li
              key={schedule.workflowId}
              className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent"
            >
              <Clock className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm",
                    !schedule.enabled && "text-muted-foreground",
                  )}
                >
                  {schedule.config?.title || schedule.name}
                </p>
                <p className="truncate text-xs text-faint-foreground">
                  {schedule.config
                    ? describeSchedule(schedule.config)
                    : "Customized in Workflows"}
                  {schedule.lastRunAt
                    ? ` · last ran ${new Date(schedule.lastRunAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {schedule.config ? (
                  <button
                    type="button"
                    onClick={() => setEditing(schedule)}
                    aria-label={`Edit ${schedule.config.title}`}
                    className="rounded-pill p-1 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : (
                  <Link
                    href={`/p/${propertyId}/workflows/${schedule.workflowId}`}
                    aria-label="Open in Workflows"
                    className="rounded-pill p-1 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void remove(schedule)}
                  aria-label={`Remove ${schedule.config?.title ?? schedule.name}`}
                  className="rounded-pill p-1 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <Switch
                  checked={schedule.enabled}
                  onCheckedChange={(next) => void toggle(schedule, next)}
                  aria-label={`${schedule.enabled ? "Pause" : "Resume"} ${
                    schedule.config?.title ?? schedule.name
                  }`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <ScheduleDialog
        propertyId={propertyId}
        projectId={projectId}
        projectName={projectName}
        timezone={timezone}
        schedule={editing}
        onClose={() => setEditing(null)}
        onSaved={(next) => qc.setQueryData(queryKey, next)}
      />
    </section>
  );
}

function ScheduleDialog({
  propertyId,
  projectId,
  projectName,
  timezone,
  schedule,
  onClose,
  onSaved,
}: {
  propertyId: string;
  projectId: string;
  projectName: string;
  timezone: string;
  schedule: ProjectSchedule | "new" | null;
  onClose: () => void;
  onSaved: (schedules: ProjectSchedule[]) => void;
}) {
  const isNew = schedule === "new";
  const existing = schedule && schedule !== "new" ? schedule : null;
  const [config, setConfig] = useState<ProjectScheduleConfig>(DEFAULT_SCHEDULE);
  const [saving, setSaving] = useState(false);

  // Load the form when a DIFFERENT schedule is opened — adjusted during
  // render on a changed value, React's sanctioned pattern. An effect here
  // would paint the previous schedule's values for a frame before swapping,
  // and the identity to compare on is the workflow id (or "new"), not the
  // object: the object is a fresh reference on every list refresh, which
  // would blow away whatever the user had typed.
  const openedId = schedule === "new" ? "new" : (schedule?.workflowId ?? null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (schedule && openedId !== loadedId) {
    setLoadedId(openedId);
    setConfig(
      existing?.config ?? { ...DEFAULT_SCHEDULE, timezone, title: "Weekly review" },
    );
  }
  if (!schedule && loadedId !== null) setLoadedId(null);

  function set<K extends keyof ProjectScheduleConfig>(
    key: K,
    value: ProjectScheduleConfig[K],
  ) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveProjectSchedule({
        propertyId,
        projectId,
        workflowId: existing?.workflowId,
        enabled: existing?.enabled ?? true,
        config,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onSaved(result.schedules);
      onClose();
      toast.success(isNew ? "Schedule created" : "Schedule updated");
    } finally {
      setSaving(false);
    }
  }

  const timeValue = `${String(config.hour).padStart(2, "0")}:${String(
    config.minute,
  ).padStart(2, "0")}`;

  return (
    <Dialog open={schedule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "New schedule" : "Edit schedule"}</DialogTitle>
          <DialogDescription>
            The assistant runs on its own and files the result in {projectName} as a
            conversation you can reply to.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="schedule-title" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="schedule-title"
              value={config.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Monday review"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="schedule-brief" className="text-sm font-medium">
              What should it do?
            </label>
            <Textarea
              id="schedule-brief"
              value={config.brief}
              onChange={(e) => set("brief", e.target.value)}
              rows={4}
              placeholder="Review open tasks and this week's bookings, flag anything at risk of slipping, and list what needs my decision."
            />
            <p className="text-xs text-faint-foreground">
              Write it as an instruction. The run already knows this project&rsquo;s
              instructions, memory, and attached documents.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-frequency" className="text-sm font-medium">
                How often
              </label>
              <NativeSelect
                id="schedule-frequency"
                value={config.frequency}
                onChange={(e) => set("frequency", e.target.value as ScheduleFrequency)}
              >
                {SCHEDULE_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-time" className="text-sm font-medium">
                At
              </label>
              <Input
                id="schedule-time"
                type="time"
                value={timeValue}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isInteger(h)) set("hour", h);
                  if (Number.isInteger(m)) set("minute", m);
                }}
              />
            </div>
          </div>

          {config.frequency === "weekly" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-weekday" className="text-sm font-medium">
                On
              </label>
              <NativeSelect
                id="schedule-weekday"
                value={String(config.weekday)}
                onChange={(e) => set("weekday", Number(e.target.value))}
              >
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {config.frequency === "monthly" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-monthday" className="text-sm font-medium">
                Day of the month
              </label>
              <NativeSelect
                id="schedule-monthday"
                value={String(config.monthDay)}
                onChange={(e) => set("monthDay", Number(e.target.value))}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-faint-foreground">
                Capped at the 28th so the schedule fires every month, February
                included.
              </p>
            </div>
          ) : null}

          <label className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm">Notify me when it finishes</span>
              <span className="block text-xs text-pretty text-muted-foreground">
                The assistant sends the notification itself, once the work is
                actually done.
              </span>
            </span>
            <Switch
              checked={config.notify}
              onCheckedChange={(next) => set("notify", next)}
            />
          </label>

          <p className="text-xs text-pretty text-faint-foreground">
            {describeSchedule(config)} · {config.timezone}. Saved as a workflow, so
            you can add steps to it in Workflows later.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || config.brief.trim().length < 10 || !config.title.trim()}
          >
            {isNew ? "Create schedule" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
