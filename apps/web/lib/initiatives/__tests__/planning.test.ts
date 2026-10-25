import { describe, expect, it } from "vitest";
import {
  computedToDeclared,
  effectiveProjectHealth,
  formatTarget,
  initiativeHealth,
  latestHealth,
  milestoneProgress,
  progressByAssignee,
  progressStats,
  rollupHealth,
} from "../planning";

describe("health", () => {
  it("maps computed pace onto the declared vocabulary", () => {
    expect(computedToDeclared("overdue")).toBe("off_track");
    expect(computedToDeclared("at_risk")).toBe("at_risk");
    expect(computedToDeclared("on_track")).toBe("on_track");
    expect(computedToDeclared("none")).toBeNull();
    expect(computedToDeclared("done")).toBeNull();
  });

  it("takes the latest update regardless of input order", () => {
    expect(
      latestHealth([
        { health: "on_track", created_at: "2026-10-01T00:00:00Z" },
        { health: "off_track", created_at: "2026-10-20T00:00:00Z" },
        { health: "at_risk", created_at: "2026-10-10T00:00:00Z" },
      ]),
    ).toBe("off_track");
    expect(latestHealth([])).toBeNull();
  });

  it("prefers a declared call over computed pace", () => {
    expect(effectiveProjectHealth("on_track", "overdue")).toBe("on_track");
    expect(effectiveProjectHealth(null, "overdue")).toBe("off_track");
    expect(effectiveProjectHealth(null, "none")).toBeNull();
  });

  it("rolls up to the worst opinion and ignores silence", () => {
    expect(rollupHealth(["on_track", null, "at_risk", undefined])).toBe("at_risk");
    expect(rollupHealth(["at_risk", "off_track", "on_track"])).toBe("off_track");
    expect(rollupHealth([null, undefined])).toBeNull();
  });

  it("initiative: own update wins, else project roll-up, else none", () => {
    expect(initiativeHealth("on_track", ["off_track"])).toEqual({
      health: "on_track",
      source: "declared",
    });
    expect(initiativeHealth(null, ["on_track", "at_risk"])).toEqual({
      health: "at_risk",
      source: "rollup",
    });
    expect(initiativeHealth(null, [null])).toEqual({ health: null, source: "none" });
  });
});

describe("progress", () => {
  const tasks = [
    { status: "done" as const, estimate: 3, assignee_id: "a" },
    { status: "in_progress" as const, estimate: null, assignee_id: "a" },
    { status: "blocked" as const, estimate: 2, assignee_id: "b" },
    { status: "todo" as const, estimate: 5, assignee_id: null },
    { status: "done" as const, estimate: 0, assignee_id: "b" },
  ];

  it("counts unestimated work as one point", () => {
    expect(progressStats(tasks)).toEqual({
      scope: 11,
      started: 3,
      completed: 3,
      tasks: 5,
      doneTasks: 2,
    });
  });

  it("breaks down by assignee, unassigned last", () => {
    const rows = progressByAssignee(tasks);
    expect(rows.map((r) => r.assigneeId)).toEqual(["a", "b", null]);
    expect(rows[0]).toMatchObject({ scope: 4, completed: 3, started: 1 });
    expect(rows[2]).toMatchObject({ scope: 5, completed: 0 });
  });

  it("milestone % is a task count over tagged tasks", () => {
    const m = milestoneProgress([
      { status: "done", milestone_id: "m1" },
      { status: "done", milestone_id: "m1" },
      { status: "todo", milestone_id: "m1" },
      { status: "todo", milestone_id: null },
      { status: "in_progress", milestone_id: "m2" },
    ]);
    expect(m.get("m1")).toEqual({ done: 2, total: 3, pct: 67 });
    expect(m.get("m2")).toEqual({ done: 0, total: 1, pct: 0 });
    expect(m.has("m3")).toBe(false);
  });
});

describe("formatTarget", () => {
  it("writes quarter ends as quarters, other days as month + year", () => {
    expect(formatTarget("2027-06-30")).toBe("Q2 2027");
    expect(formatTarget("2026-12-31")).toBe("Q4 2026");
    expect(formatTarget("2026-12-15")).toBe("Dec 2026");
    expect(formatTarget("2027-02-28")).toBe("Feb 2027");
    expect(formatTarget(null)).toBeNull();
    expect(formatTarget("nope")).toBeNull();
  });
});
