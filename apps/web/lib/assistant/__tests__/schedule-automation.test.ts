import { describe, it, expect } from "vitest";
import { validateSpec } from "@/lib/workflows/validate";
import { getStep } from "@/lib/workflows/catalog";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import {
  DEFAULT_SCHEDULE,
  buildProjectScheduleSpec,
  cronToSchedule,
  describeSchedule,
  extractProjectScheduleConfig,
  scheduleToCron,
  specTargetsProject,
  type ProjectScheduleConfig,
} from "@/lib/assistant/schedule-automation";

/**
 * A project schedule is a REAL workflow, so the contract that matters is that
 * the spec this module emits is one the workflow engine actually accepts, and
 * that it round-trips back into the card's controls. A schedule that saves but
 * cannot be re-read would silently strand the card in read-only mode.
 */

const PROJECT = "11111111-2222-3333-4444-555555555555";

function config(patch: Partial<ProjectScheduleConfig> = {}): ProjectScheduleConfig {
  return {
    ...DEFAULT_SCHEDULE,
    brief: "Review open tasks and flag anything at risk.",
    title: "Monday review",
    timezone: "Africa/Nairobi",
    ...patch,
  };
}

describe("cron compilation", () => {
  it("compiles each frequency", () => {
    expect(scheduleToCron(config({ frequency: "daily", hour: 7, minute: 30 }))).toBe(
      "30 7 * * *",
    );
    expect(scheduleToCron(config({ frequency: "weekdays", hour: 9, minute: 0 }))).toBe(
      "0 9 * * 1-5",
    );
    expect(
      scheduleToCron(config({ frequency: "weekly", weekday: 1, hour: 8, minute: 0 })),
    ).toBe("0 8 * * 1");
    expect(
      scheduleToCron(config({ frequency: "monthly", monthDay: 1, hour: 6, minute: 15 })),
    ).toBe("15 6 1 * *");
  });

  it("caps the day of month at 28 so every month fires", () => {
    // "The 31st" skips February and the 30-day months — a schedule that
    // mostly doesn't run reads as broken, not as a calendar subtlety.
    expect(scheduleToCron(config({ frequency: "monthly", monthDay: 31 }))).toBe(
      "0 8 28 * *",
    );
  });

  it("clamps out-of-range times rather than emitting invalid cron", () => {
    expect(scheduleToCron(config({ hour: 99, minute: -5, frequency: "daily" }))).toBe(
      "0 23 * * *",
    );
  });
});

describe("cron round-trip", () => {
  it("parses back everything it emits", () => {
    const cases: Partial<ProjectScheduleConfig>[] = [
      { frequency: "daily", hour: 7, minute: 30 },
      { frequency: "weekdays", hour: 9, minute: 0 },
      { frequency: "weekly", weekday: 3, hour: 17, minute: 45 },
      { frequency: "monthly", monthDay: 12, hour: 6, minute: 5 },
    ];
    for (const patch of cases) {
      const cfg = config(patch);
      const parsed = cronToSchedule(scheduleToCron(cfg));
      expect(parsed, `round-trip failed for ${JSON.stringify(patch)}`).toBeTruthy();
      expect(parsed!.frequency).toBe(cfg.frequency);
      expect(parsed!.hour).toBe(cfg.hour);
      expect(parsed!.minute).toBe(cfg.minute);
      if (cfg.frequency === "weekly") expect(parsed!.weekday).toBe(cfg.weekday);
      if (cfg.frequency === "monthly") expect(parsed!.monthDay).toBe(cfg.monthDay);
    }
  });

  it("refuses crons the picker cannot express", () => {
    // Returning null is what sends the card read-only instead of silently
    // rewriting someone's hand-tuned expression on the next save.
    for (const cron of [
      "*/15 * * * *",
      "0 9 * * 1,3,5",
      "0 9 1 6 *",
      "0 9 * *",
      "not a cron",
      "0 9 31 * *",
    ]) {
      expect(cronToSchedule(cron), `expected null for "${cron}"`).toBeNull();
    }
  });
});

describe("spec building", () => {
  it("emits a spec the workflow engine accepts", () => {
    const spec = buildProjectScheduleSpec({
      projectId: PROJECT,
      projectName: "Kaya Villa",
      config: config(),
    });
    const result = validateSpec(spec);
    expect(
      result.ok,
      result.ok ? "" : result.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    ).toBe(true);
  });

  it("puts the cron where saveWorkflow's scheduler reads it", () => {
    // THE bug this test exists for: `TriggerFilter` is `.passthrough()`, so a
    // cron placed under `trigger.filter` validates perfectly — and then
    // reconcileCronSchedule (lib/workflows/save.ts), which reads
    // `trigger.schedule.cron`, finds nothing and never registers the pg_cron
    // job. The workflow saves, renders correctly in the builder, and silently
    // never fires. Validation alone cannot catch it.
    const spec = buildProjectScheduleSpec({
      projectId: PROJECT,
      projectName: "Kaya Villa",
      config: config({ frequency: "weekly", weekday: 1, hour: 8, minute: 0 }),
    });
    expect(spec.trigger.schedule?.cron).toBe("0 8 * * 1");
    expect(spec.trigger.schedule?.timezone).toBe("Africa/Nairobi");
    expect(
      (spec.trigger as Record<string, unknown>).filter,
      "the cron must not live under `filter` — nothing schedules from there",
    ).toBeUndefined();
  });

  it("round-trips through extract", () => {
    const cfg = config({ frequency: "weekly", weekday: 2, hour: 6, minute: 30 });
    const spec = buildProjectScheduleSpec({
      projectId: PROJECT,
      projectName: "Kaya Villa",
      config: cfg,
    });
    expect(extractProjectScheduleConfig(spec)).toEqual(cfg);
  });

  it("matches its own project and no other", () => {
    const spec = buildProjectScheduleSpec({
      projectId: PROJECT,
      projectName: "Kaya Villa",
      config: config(),
    });
    expect(specTargetsProject(spec, PROJECT)).toBe(true);
    expect(specTargetsProject(spec, "99999999-9999-9999-9999-999999999999")).toBe(false);
  });
});

describe("extract refuses what the card cannot round-trip", () => {
  const base = () =>
    buildProjectScheduleSpec({
      projectId: PROJECT,
      projectName: "Kaya Villa",
      config: config(),
    }) as ReturnType<typeof buildProjectScheduleSpec> & {
      steps: Record<string, { type: string; config: Record<string, unknown> }>;
    };

  it("rejects a second step", () => {
    const spec = base();
    (spec.steps as Record<string, unknown>)["extra"] = {
      id: "extra",
      type: "action.notify.role",
      config: { role: "owner", title: "hi" },
    };
    expect(extractProjectScheduleConfig(spec)).toBeNull();
  });

  it("rejects a templated brief or project id", () => {
    const templatedBrief = base();
    templatedBrief.steps["assistant-run"].config.brief = "{{trigger.fired_at}}";
    expect(extractProjectScheduleConfig(templatedBrief)).toBeNull();

    const templatedProject = base();
    templatedProject.steps["assistant-run"].config.project_id = "{{trigger.x}}";
    expect(extractProjectScheduleConfig(templatedProject)).toBeNull();
  });

  it("rejects a non-schedule trigger", () => {
    const spec = base() as unknown as { trigger: { event_type: string } };
    spec.trigger.event_type = "manual.run";
    expect(extractProjectScheduleConfig(spec)).toBeNull();
  });
});

describe("human description", () => {
  it("reads as a sentence", () => {
    expect(describeSchedule(config({ frequency: "daily", hour: 7, minute: 0 }))).toBe(
      "Every day at 07:00",
    );
    expect(
      describeSchedule(config({ frequency: "weekly", weekday: 1, hour: 8, minute: 30 })),
    ).toBe("Every Monday at 08:30");
    expect(describeSchedule(config({ frequency: "weekdays", hour: 9, minute: 5 }))).toBe(
      "Every weekday at 09:05",
    );
    expect(
      describeSchedule(config({ frequency: "monthly", monthDay: 1, hour: 6, minute: 0 })),
    ).toBe("Monthly on the 1st at 06:00");
    expect(
      describeSchedule(config({ frequency: "monthly", monthDay: 22, hour: 6, minute: 0 })),
    ).toBe("Monthly on the 22nd at 06:00");
  });
});

/**
 * Drift guards. `action.assistant.run` is spread across four files that have
 * no compile-time link to each other — the spec's discriminated union, the
 * catalog metadata the builder renders from, the field defs its config editor
 * reads, and the runner registry. A step present in the union but missing from
 * the catalog is invisible in the builder; missing from the registry it saves
 * fine and does nothing at runtime.
 */
describe("action.assistant.run stays wired", () => {
  it("is in the catalog with the AI surface", () => {
    const entry = getStep("action.assistant.run");
    expect(entry, "not registered in the workflow catalog").toBeTruthy();
    expect(entry!.surface).toBe("ai");
    expect(entry!.category).toBe("action");
  });

  it("has builder field defs for the config the card writes", () => {
    const fields = STEP_FIELDS["action.assistant.run"];
    expect(fields, "no field defs — the builder renders an empty config panel").toBeTruthy();
    const keys = fields!.map((f) => f.key);
    expect(keys).toContain("brief");
    expect(keys).toContain("project_id");
    // `notify` is deliberately absent: there is no boolean field kind, and
    // faking one with an enum of strings would fail the spec's z.boolean().
    expect(keys).not.toContain("notify");
  });

  it("has a runner registered", async () => {
    // Imported lazily: the registry pulls in server-only modules.
    const { RUNNERS } = await import("@/lib/workflows/runners");
    expect(
      RUNNERS["action.assistant.run"],
      "no runner — a schedule would save and then quietly do nothing",
    ).toBeTruthy();
  });
});
