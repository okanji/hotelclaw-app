/**
 * Scheduled assistant runs for a project — the pure half.
 *
 * A schedule IS a workflow: `schedule.cron` trigger → one `action.assistant.run`
 * step. The project's Scheduled card manages that workflow through this module,
 * the same write-through pattern the Forms "submissions become tasks" panel
 * uses (lib/forms/task-automation.ts). Two consequences worth keeping in mind:
 *
 *  1. Every schedule is visible and editable in Workflows like any other
 *     automation. Nothing here is a parallel scheduling system.
 *  2. If someone customizes one in the builder — adds a step, templates the
 *     project id — the card can no longer round-trip it, so `extract…` returns
 *     null and the card goes read-only and links to the builder.
 *
 * No "server-only": these are pure functions so the tests can validate the
 * emitted specs against lib/workflows/validate without a server context.
 */

export const SCHEDULE_FREQUENCIES = ["daily", "weekdays", "weekly", "monthly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export type ProjectScheduleConfig = {
  /** What the assistant should do. Free text, becomes the turn's message. */
  brief: string;
  /** Conversation title for each run, e.g. "Monday review". */
  title: string;
  frequency: ScheduleFrequency;
  /** Local hour, 0–23, in `timezone`. */
  hour: number;
  /** Local minute, 0–59. */
  minute: number;
  /** 0 = Sunday … 6 = Saturday. Only meaningful for `weekly`. */
  weekday: number;
  /** 1–28. Only meaningful for `monthly` — capped at 28 so every month fires. */
  monthDay: number;
  /** IANA zone the cron is evaluated in. */
  timezone: string;
  /** Ask the assistant to notify the owner when the run finishes. */
  notify: boolean;
};

export const DEFAULT_SCHEDULE: ProjectScheduleConfig = {
  brief: "",
  title: "",
  frequency: "weekly",
  hour: 8,
  minute: 0,
  weekday: 1,
  monthDay: 1,
  timezone: "UTC",
  notify: true,
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Compile the picker's answer into a 5-field cron expression.
 *
 * The day-of-month ceiling is 28 on purpose: "the 31st" silently skips
 * February and most second months, which reads as a broken schedule rather
 * than as a calendar subtlety.
 */
export function scheduleToCron(config: ProjectScheduleConfig): string {
  const minute = clamp(config.minute, 0, 59);
  const hour = clamp(config.hour, 0, 23);
  switch (config.frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${clamp(config.weekday, 0, 6)}`;
    case "monthly":
      return `${minute} ${hour} ${clamp(config.monthDay, 1, 28)} * *`;
  }
}

/** "Every Monday at 08:00" — the sentence the card shows under each schedule. */
export function describeSchedule(config: ProjectScheduleConfig): string {
  const time = `${String(clamp(config.hour, 0, 23)).padStart(2, "0")}:${String(
    clamp(config.minute, 0, 59),
  ).padStart(2, "0")}`;
  const when = (() => {
    switch (config.frequency) {
      case "daily":
        return "Every day";
      case "weekdays":
        return "Every weekday";
      case "weekly":
        return `Every ${WEEKDAY_NAMES[clamp(config.weekday, 0, 6)]}`;
      case "monthly": {
        const day = clamp(config.monthDay, 1, 28);
        const suffix =
          day % 10 === 1 && day !== 11
            ? "st"
            : day % 10 === 2 && day !== 12
              ? "nd"
              : day % 10 === 3 && day !== 13
                ? "rd"
                : "th";
        return `Monthly on the ${day}${suffix}`;
      }
    }
  })();
  return `${when} at ${time}`;
}

/** Build the workflow spec behind one project schedule. */
export function buildProjectScheduleSpec(args: {
  projectId: string;
  projectName: string;
  config: ProjectScheduleConfig;
}) {
  const { config } = args;
  const title = config.title.trim() || "Scheduled run";
  return {
    workflow_spec_version: 1,
    name: `${args.projectName}: ${title}`,
    trigger: {
      event_type: "schedule.cron" as const,
      // `schedule`, NOT `filter`. TriggerFilter is `.passthrough()`, so a cron
      // put under `filter` validates cleanly — and then saveWorkflow's
      // reconcileCronSchedule, which reads `trigger.schedule.cron`, finds
      // nothing and never registers the pg_cron job. The workflow saves, looks
      // right in the builder, and silently never fires.
      schedule: { cron: scheduleToCron(config), timezone: config.timezone },
    },
    entry_step_id: "assistant-run",
    steps: {
      "assistant-run": {
        id: "assistant-run",
        type: "action.assistant.run" as const,
        label: title,
        config: {
          brief: config.brief.trim(),
          project_id: args.projectId,
          title,
          notify: config.notify,
        },
      },
    },
  };
}

type LooseSpec = {
  trigger?: { event_type?: string; schedule?: unknown };
  steps?: Record<
    string,
    { type?: string; label?: string; config?: Record<string, unknown> | undefined }
  >;
};

/** Does this workflow run the assistant against `projectId` on a schedule? */
export function specTargetsProject(spec: unknown, projectId: string): boolean {
  const s = spec as LooseSpec | null;
  if (s?.trigger?.event_type !== "schedule.cron") return false;
  return Object.values(s.steps ?? {}).some(
    (step) =>
      step?.type === "action.assistant.run" &&
      step.config?.project_id === projectId,
  );
}

/**
 * Parse a cron expression back into the picker's shape. Returns null for
 * anything the picker cannot express — step values, lists, ranges other than
 * the weekday one it emits — which is what puts the card into read-only mode
 * rather than silently rewriting someone's hand-tuned cron.
 */
export function cronToSchedule(
  cron: string,
): Pick<
  ProjectScheduleConfig,
  "frequency" | "hour" | "minute" | "weekday" | "monthDay"
> | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, month, dow] = parts;
  if (month !== "*") return null;

  const minute = Number(min);
  const hour = Number(hr);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const base = { hour, minute, weekday: 1, monthDay: 1 };

  if (dom === "*" && dow === "*") return { ...base, frequency: "daily" };
  if (dom === "*" && dow === "1-5") return { ...base, frequency: "weekdays" };
  if (dom === "*" && /^[0-6]$/.test(dow)) {
    return { ...base, frequency: "weekly", weekday: Number(dow) };
  }
  if (dow === "*" && /^\d{1,2}$/.test(dom)) {
    const day = Number(dom);
    if (day < 1 || day > 28) return null;
    return { ...base, frequency: "monthly", monthDay: day };
  }
  return null;
}

/**
 * Extract the card-editable config from a workflow spec. `null` means the
 * workflow was customized beyond what the card can round-trip — extra steps,
 * a templated project id, or a cron the picker cannot express.
 */
export function extractProjectScheduleConfig(
  spec: unknown,
): ProjectScheduleConfig | null {
  const s = spec as LooseSpec | null;
  if (s?.trigger?.event_type !== "schedule.cron") return null;

  const steps = Object.values(s.steps ?? {});
  if (steps.length !== 1) return null;
  const step = steps[0];
  if (step?.type !== "action.assistant.run") return null;

  const config = step.config ?? {};
  const brief = typeof config.brief === "string" ? config.brief : "";
  // A templated brief or project id is the builder's territory, not the card's.
  if (!brief || brief.includes("{{")) return null;
  if (typeof config.project_id !== "string" || config.project_id.includes("{{")) {
    return null;
  }
  const title = typeof config.title === "string" ? config.title : "";
  if (title.includes("{{")) return null;

  const schedule = (s.trigger.schedule ?? {}) as { cron?: unknown; timezone?: unknown };
  if (typeof schedule.cron !== "string") return null;
  const timing = cronToSchedule(schedule.cron);
  if (!timing) return null;

  return {
    brief,
    title: title || step.label || "Scheduled run",
    timezone: typeof schedule.timezone === "string" ? schedule.timezone : "UTC",
    notify: config.notify !== false,
    ...timing,
  };
}
