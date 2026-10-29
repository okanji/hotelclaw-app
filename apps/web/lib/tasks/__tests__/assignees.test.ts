import { describe, expect, it } from "vitest";
import {
  assigneeIdsFromEmbed,
  diffAssignees,
  isAssignedTo,
  makePrimary,
  MAX_ASSIGNEES,
  normalizeAssigneeIds,
  taskAssigneeIds,
  toggleAssignee,
} from "../assignees";
import { assigneeSummary } from "../assignee-label";

describe("taskAssigneeIds", () => {
  it("prefers the embedded set", () => {
    expect(taskAssigneeIds({ assignee_ids: ["a", "b"], assignee_id: "a" })).toEqual(["a", "b"]);
  });
  it("falls back to the legacy primary for old cached rows", () => {
    expect(taskAssigneeIds({ assignee_id: "a" })).toEqual(["a"]);
    expect(taskAssigneeIds({ assignee_ids: [], assignee_id: "a" })).toEqual(["a"]);
    expect(taskAssigneeIds({ assignee_id: null })).toEqual([]);
  });
  it("isAssignedTo matches any assignee, not just the primary", () => {
    expect(isAssignedTo({ assignee_ids: ["a", "b"], assignee_id: "a" }, "b")).toBe(true);
    expect(isAssignedTo({ assignee_id: "a" }, "b")).toBe(false);
  });
});

describe("set edits", () => {
  it("diffs added and removed, ignoring order", () => {
    expect(diffAssignees(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
    expect(diffAssignees(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });
  it("normalizes duplicates and caps", () => {
    expect(normalizeAssigneeIds(["a", "b", "a", ""])).toEqual(["a", "b"]);
    const many = Array.from({ length: 30 }, (_, i) => `u${i}`);
    expect(normalizeAssigneeIds(many)).toHaveLength(MAX_ASSIGNEES);
  });
  it("toggles and promotes", () => {
    expect(toggleAssignee(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleAssignee(["a", "b"], "a")).toEqual(["b"]);
    expect(makePrimary(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(makePrimary(["a"], "z")).toEqual(["a"]);
  });
  it("orders the embed by position, then age", () => {
    expect(
      assigneeIdsFromEmbed([
        { user_id: "b", position: 1, created_at: "2026-01-01" },
        { user_id: "c", position: 0, created_at: "2026-01-02" },
        { user_id: "a", position: 0, created_at: "2026-01-01" },
      ]),
    ).toEqual(["a", "c", "b"]);
    expect(assigneeIdsFromEmbed(null)).toEqual([]);
  });
});

describe("assigneeSummary", () => {
  it("reads Assign / name / name +N", () => {
    expect(assigneeSummary([], {})).toBe("Assign");
    expect(assigneeSummary(["a"], { a: { name: "Ana" } })).toBe("Ana");
    expect(assigneeSummary(["a", "b", "c"], { a: { name: "Ana" } })).toBe("Ana +2");
  });
});
