import { describe, expect, it } from "vitest";
import {
  deleteBlocker,
  fallbackFor,
  forkPlan,
  ladder,
  newStatusDraft,
  positionAfter,
  remapPlan,
  validateSet,
  type StatusDraft,
} from "../status-set-rules";

let n = 0;
const st = (
  name: string,
  category: StatusDraft["category"],
  over: Partial<StatusDraft> = {},
): StatusDraft => ({
  id: `st-${name.replace(/\s+/g, "-").toLowerCase()}`,
  name,
  category,
  is_blocked: false,
  color: "slate",
  position: (n += 1024),
  ...over,
});

const MAINT: StatusDraft[] = [
  st("requests", "open"),
  st("preparation", "active"),
  st("quoting", "active"),
  st("awaiting payment", "active", { is_blocked: true }),
  st("in progress", "active"),
  st("ready for review", "done"),
  st("completed", "closed"),
];

describe("validateSet", () => {
  it("accepts the Maintenance pipeline", () => {
    expect(validateSet(MAINT)).toEqual([]);
  });
  it("needs exactly one open and one closed", () => {
    expect(validateSet(MAINT.filter((r) => r.category !== "open")).map((p) => p.kind)).toEqual(["no_open"]);
    expect(validateSet([...MAINT, st("done 2", "closed")]).map((p) => p.kind)).toEqual(["many_closed"]);
    expect(validateSet([...MAINT, st("new", "open")]).map((p) => p.kind)).toEqual(["many_open"]);
  });
  it("rejects duplicate names case-insensitively, empty names and blocked on non-active", () => {
    const probs = validateSet([
      ...MAINT,
      st("Quoting", "active"),
      st("", "active"),
      st("stuck", "done", { is_blocked: true }),
    ]);
    expect(probs.map((p) => p.kind).sort()).toEqual(
      ["blocked_not_active", "duplicate_name", "empty_name"].sort(),
    );
  });
});

describe("deleteBlocker + fallbackFor", () => {
  it("protects the only open / closed status", () => {
    expect(deleteBlocker(MAINT, "st-requests")).toMatch(/entry point/);
    expect(deleteBlocker(MAINT, "st-completed")).toMatch(/Closed/);
    expect(deleteBlocker(MAINT, "st-quoting")).toBeNull();
  });
  it("sends a deleted status's tasks to the closest remaining status", () => {
    expect(fallbackFor(MAINT, "st-quoting")?.id).toBe("st-preparation");
    expect(fallbackFor(MAINT, "st-awaiting-payment")?.id).toBe("st-preparation");
    expect(fallbackFor(MAINT, "st-ready-for-review")?.id).toBe("st-completed");
  });
});

describe("ordering", () => {
  it("positionAfter lands between neighbours / at the ends", () => {
    const p = positionAfter(MAINT, "st-requests");
    expect(p).toBeGreaterThan(MAINT[0].position);
    expect(p).toBeLessThan(MAINT[1].position);
    expect(positionAfter(MAINT, null)).toBeLessThan(MAINT[0].position);
    expect(positionAfter(MAINT, "st-completed")).toBeGreaterThan(MAINT[6].position);
  });
  it("ladder renumbers in 1024 steps", () => {
    expect(ladder(["a", "b", "c"])).toEqual({ a: 1024, b: 2048, c: 3072 });
  });
});

describe("fork + inherit plans", () => {
  it("forkPlan copies every row in order and maps old ids to indexes", () => {
    const { rows, indexOf } = forkPlan(MAINT);
    expect(rows.map((r) => r.name)).toEqual(MAINT.map((r) => r.name));
    expect(rows[3].is_blocked).toBe(true);
    expect(indexOf["st-requests"]).toBe(0);
    expect(indexOf["st-completed"]).toBe(6);
  });
  it("remapPlan maps by category + blocked into the target set", () => {
    const DEFAULT: StatusDraft[] = [
      st("To do", "open"),
      st("In progress", "active"),
      st("Blocked", "active", { is_blocked: true }),
      st("Done", "closed"),
    ];
    const plan = remapPlan(MAINT, DEFAULT);
    expect(plan["st-requests"]).toBe("st-to-do");
    expect(plan["st-quoting"]).toBe("st-in-progress");
    expect(plan["st-awaiting-payment"]).toBe("st-blocked");
    expect(plan["st-ready-for-review"]).toBe("st-done");
    expect(plan["st-completed"]).toBe("st-done");
  });
});

describe("newStatusDraft", () => {
  it("names by category, dedupes, appends at the end", () => {
    const d = newStatusDraft("active", MAINT);
    expect(d.name).toBe("Active");
    expect(d.position).toBeGreaterThan(MAINT[6].position);
    const d2 = newStatusDraft("active", [...MAINT, { ...d, id: "x" }]);
    expect(d2.name).toBe("Active 2");
  });
});
