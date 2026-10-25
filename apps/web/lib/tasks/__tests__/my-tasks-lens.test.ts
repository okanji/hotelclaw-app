import { describe, expect, it } from "vitest";
import {
  assignedRows,
  createdRows,
  openCount,
  parseMyTasksTab,
} from "../my-tasks-lens";

const ME = "me";
const t = (
  id: string,
  over: Partial<{
    status: string;
    assignee_id: string | null;
    created_by: string | null;
    parent_id: string | null;
  }> = {},
) => ({ id, status: "todo", assignee_id: null, created_by: null, parent_id: null, ...over });

describe("parseMyTasksTab", () => {
  it("accepts known tabs and falls back to focus", () => {
    expect(parseMyTasksTab("assigned")).toBe("assigned");
    expect(parseMyTasksTab("activity")).toBe("activity");
    expect(parseMyTasksTab("subscribed")).toBe("focus");
    expect(parseMyTasksTab(null)).toBe("focus");
  });
});

describe("assignedRows", () => {
  const tasks = [
    t("a", { assignee_id: ME }),
    t("a1", { assignee_id: ME, parent_id: "a" }),
    t("b", { assignee_id: "other" }),
    t("b1", { assignee_id: ME, parent_id: "b" }),
    t("c", { assignee_id: ME, status: "done" }),
  ];
  it("keeps my tasks, nests my sub-issues under my parents, surfaces orphans", () => {
    expect(assignedRows(tasks, ME).map((x) => x.id)).toEqual(["a", "b1", "c"]);
  });
  it("open count ignores done", () => {
    expect(openCount(assignedRows(tasks, ME))).toBe(2);
  });
});

describe("createdRows", () => {
  it("is independent of the assignee", () => {
    const tasks = [
      t("x", { created_by: ME, assignee_id: "other" }),
      t("y", { created_by: "other", assignee_id: ME }),
    ];
    expect(createdRows(tasks, ME).map((x) => x.id)).toEqual(["x"]);
  });
});
