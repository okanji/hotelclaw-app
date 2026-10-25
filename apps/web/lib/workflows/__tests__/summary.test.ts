import { describe, expect, it } from "vitest";
import { TRIGGERS } from "@/lib/workflows/catalog";
import {
  RUN_NOW_TRIGGERS,
  canRunNow,
  primaryAction,
  runStatusLabel,
  triggerLabel,
} from "@/lib/workflows/summary";

describe("workflow summary", () => {
  it("every run-now trigger is a real catalog trigger", () => {
    const ids = new Set(TRIGGERS.map((t) => t.id as string));
    for (const id of RUN_NOW_TRIGGERS) expect(ids.has(id)).toBe(true);
  });

  it("only event-free triggers can run now", () => {
    expect(canRunNow("manual.run")).toBe(true);
    expect(canRunNow("schedule.cron")).toBe(true);
    expect(canRunNow("task.created")).toBe(false);
    expect(canRunNow(null)).toBe(false);
  });

  it("labels triggers from the catalog, falling back to the id", () => {
    expect(triggerLabel("task.created")).toBe("When a task is created");
    expect(triggerLabel("nope.unknown")).toBe("nope.unknown");
    expect(triggerLabel(null)).toBeNull();
  });

  it("names the first non-control step and counts the rest", () => {
    const a = primaryAction(["control.filter", "action.notify.user", "action.chat.post_message"]);
    expect(a?.label).toBe("Notify a user");
    expect(a?.more).toBe(1);
    expect(primaryAction(["control.delay"])).toBeNull();
    expect(primaryAction([])).toBeNull();
  });

  it("sentence-cases run statuses", () => {
    expect(runStatusLabel("succeeded")).toBe("Succeeded");
  });
});
