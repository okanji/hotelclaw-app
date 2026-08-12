import { describe, expect, it } from "vitest";
import {
  computeColumnCalc,
  compareBySort,
  calcsForColumn,
  resolveColumns,
  type ResolvedColumn,
  type SortContext,
} from "@/lib/tasks/list-columns";
import {
  newOption,
  parseOptionsInput,
  selectedOptions,
} from "@/lib/tasks/custom-field-options";
import type { Task } from "@/components/tasks/kanban";
import type { CustomFieldRow } from "@/lib/query/custom-field-queries";

// Pure-logic coverage for the custom-fields core: option parsing (the id
// stability rules the whole values table depends on), list sorting, layout
// resolution, and the footer calculations.

function fieldRow(over: Partial<CustomFieldRow>): CustomFieldRow {
  return {
    id: "f1",
    space_id: null,
    name: "Field",
    type: "select",
    options: [],
    position: 0,
    ...over,
  };
}

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? "t1",
    title: "Task",
    status: "todo",
    priority: "none",
    position: 0,
    property_id: "p",
    assignee_id: null,
    due_at: null,
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Task;
}

const CTX: SortContext = {
  assigneeName: () => "",
  spaceName: () => "",
  fieldValue: () => null,
};

describe("parseOptionsInput", () => {
  it("splits newline-first so a pasted sheet column works", () => {
    const out = parseOptionsInput("Request\nQuoting\nOrdered");
    expect(out.map((o) => o.label)).toEqual(["Request", "Quoting", "Ordered"]);
  });

  it("keeps the id and color of an existing option matched by label", () => {
    const existing = [{ id: "quoted", label: "Quoted", color: "rose" as const }];
    const out = parseOptionsInput("Quoted, New one", existing);
    expect(out[0]).toEqual(existing[0]);
    expect(out[1]!.id).toBe("new-one");
  });

  it("suffixes colliding slugs instead of merging distinct labels", () => {
    const out = parseOptionsInput("Front desk\nfront-desk");
    expect(out[0]!.id).toBe("front-desk");
    expect(out[1]!.id).toBe("front-desk-2");
  });
});

describe("newOption", () => {
  it("never reuses an existing id (rename-in-place safety)", () => {
    const existing = [{ id: "vip", label: "VIP" }];
    expect(newOption("VIP", existing).id).toBe("vip-2");
  });
});

describe("compareBySort", () => {
  const column: ResolvedColumn = {
    id: "priority",
    label: "Priority",
    width: 100,
    minWidth: 90,
    sortable: true,
  };

  it("buries blanks last in both directions", () => {
    const withPriority = task({ id: "a", priority: "low" });
    const none = task({ id: "b", priority: "none" });
    expect(compareBySort(withPriority, none, column, "asc", CTX)).toBeLessThan(0);
    expect(compareBySort(withPriority, none, column, "desc", CTX)).toBeLessThan(0);
  });

  it("orders urgent before low ascending", () => {
    const urgent = task({ id: "a", priority: "urgent" });
    const low = task({ id: "b", priority: "low" });
    expect(compareBySort(urgent, low, column, "asc", CTX)).toBeLessThan(0);
  });
});

describe("resolveColumns", () => {
  it("drops unknown and archived field columns and de-dupes", () => {
    const fields = [fieldRow({ id: "live", name: "Live" })];
    const out = resolveColumns(
      [
        { id: "priority", width: 100 },
        { id: "priority", width: 100 },
        { id: "field:live", width: 100 },
        { id: "field:archived", width: 100 },
        { id: "nonsense", width: 100 },
      ],
      fields,
    );
    expect(out.map((c) => c.id)).toEqual(["priority", "field:live"]);
  });

  it("parses a stored calc and ignores unknown calc ids", () => {
    const out = resolveColumns(
      [
        { id: "priority", width: 100, calc: "count_values" },
        { id: "due", width: 100, calc: "bogus" },
      ],
      [],
    );
    expect(out[0]!.calc).toBe("count_values");
    expect(out[1]!.calc).toBeUndefined();
  });
});

describe("column calculations", () => {
  const numberField = fieldRow({ id: "cost", name: "Cost", type: "number" });
  const column: ResolvedColumn = {
    id: "field:cost",
    label: "Cost",
    width: 100,
    minWidth: 90,
    sortable: true,
    field: numberField,
  };
  const values = new Map<string, number>([
    ["a", 10],
    ["b", 32.5],
  ]);
  const ctx: SortContext = {
    ...CTX,
    fieldValue: (taskId) => values.get(taskId) ?? null,
  };
  const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];

  it("offers arithmetic only on numeric columns", () => {
    expect(calcsForColumn(column)).toContain("sum");
    expect(
      calcsForColumn({ ...column, field: undefined, id: "assignee" }),
    ).not.toContain("sum");
    expect(calcsForColumn({ ...column, field: undefined, id: "due" })).toContain(
      "earliest",
    );
  });

  it("sums, averages, and counts over visible tasks", () => {
    expect(computeColumnCalc("sum", column, tasks, ctx)).toBe("42.5");
    expect(computeColumnCalc("avg", column, tasks, ctx)).toBe("21.25");
    expect(computeColumnCalc("count_values", column, tasks, ctx)).toBe("2");
    expect(computeColumnCalc("count_empty", column, tasks, ctx)).toBe("1");
    expect(computeColumnCalc("pct_not_empty", column, tasks, ctx)).toBe("67%");
  });

  it("returns null when a calc has nothing to chew on", () => {
    const empty: SortContext = { ...CTX, fieldValue: () => null };
    expect(computeColumnCalc("sum", column, tasks, empty)).toBeNull();
  });

  it("picks earliest/latest for date columns", () => {
    const dueColumn: ResolvedColumn = {
      id: "due",
      label: "Due",
      width: 100,
      minWidth: 90,
      sortable: true,
    };
    const dated = [
      task({ id: "a", due_at: "2026-03-05T00:00:00Z" }),
      task({ id: "b", due_at: "2026-01-02T00:00:00Z" }),
      task({ id: "c" }),
    ];
    expect(computeColumnCalc("earliest", dueColumn, dated, CTX)).toContain(
      "2026",
    );
    expect(computeColumnCalc("earliest", dueColumn, dated, CTX)).toContain("Jan");
    expect(computeColumnCalc("latest", dueColumn, dated, CTX)).toContain("Mar");
  });
});

describe("selectedOptions", () => {
  it("drops orphaned ids instead of crashing", () => {
    const field = { options: [{ id: "a", label: "A" }] };
    expect(selectedOptions(field, ["a", "deleted"]).map((o) => o.id)).toEqual([
      "a",
    ]);
  });
});
