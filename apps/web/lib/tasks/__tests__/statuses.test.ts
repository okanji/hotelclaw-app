import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORY_COLUMNS,
  CATEGORY_META,
  buildCatalog,
  columnOfTask,
  columnsFor,
  isBlocked,
  isDone,
  isNotStarted,
  isStarted,
  legacyOf,
  remapForSet,
  resolveStatusInput,
  statusForLegacy,
  type StatusRow,
} from "../statuses";

const SET = "set-maint";

let n = 0;
const st = (
  name: string,
  category: StatusRow["category"],
  over: Partial<StatusRow> = {},
): StatusRow => ({
  id: `st-${name.replace(/\s+/g, "-").toLowerCase()}`,
  status_set_id: SET,
  property_id: "p",
  name,
  category,
  is_blocked: false,
  color: "slate",
  position: (n += 1024),
  archived_at: null,
  ...over,
});

/** Temple Point's Maintenance Request/Work pipeline, as ClickUp types it. */
const MAINTENANCE: StatusRow[] = [
  st("requests", "open"),
  st("preventative routines", "unstarted"),
  st("subtask", "unstarted"),
  st("preparation", "active"),
  st("material check", "active"),
  st("quoting", "active"),
  st("quote approval", "active"),
  st("procurement", "active"),
  st("lpo approval", "active"),
  st("budget check", "active"),
  st("budget allocated", "active"),
  st("send lpo", "active"),
  st("awaiting payment", "active", { is_blocked: true }),
  st("awaiting delivery", "active", { is_blocked: true }),
  st("ready to schedule", "active"),
  st("scheduled work", "active"),
  st("issues", "active", { is_blocked: true }),
  st("in progress", "active"),
  st("ready for review", "done"),
  st("finalize payment", "done"),
  st("completed", "closed"),
];

const DEFAULT: StatusRow[] = [
  st("To do", "open", { status_set_id: "set-default" }),
  st("In progress", "active", { status_set_id: "set-default" }),
  st("Blocked", "active", { status_set_id: "set-default", is_blocked: true }),
  st("Done", "closed", { status_set_id: "set-default" }),
];

describe("legacyOf ↔ migration projection", () => {
  it("projects every category to the 0001 literal the SQL does", () => {
    expect(legacyOf({ category: "open", is_blocked: false })).toBe("todo");
    expect(legacyOf({ category: "unstarted", is_blocked: false })).toBe("todo");
    expect(legacyOf({ category: "active", is_blocked: false })).toBe("in_progress");
    expect(legacyOf({ category: "active", is_blocked: true })).toBe("blocked");
    expect(legacyOf({ category: "done", is_blocked: false })).toBe("done");
    expect(legacyOf({ category: "closed", is_blocked: false })).toBe("done");
  });

  it("matches the CASE in 0114's legacy_status_of (tripwire)", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "..", "supabase", "migrations", "0114_lists_and_statuses.sql"),
      "utf8",
    );
    const start = sql.indexOf("function public.legacy_status_of");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    const pairs = [...body.matchAll(/when\s+'(\w+)'\s+then\s+'(\w+)'/g)].map((m) => [m[1], m[2]]);
    for (const [category, legacy] of pairs) {
      expect(CATEGORY_META[category as keyof typeof CATEGORY_META].legacy).toBe(legacy);
    }
    expect(pairs.map((p) => p[0]).sort()).toEqual(["closed", "done", "open", "unstarted"]);
    expect(body).toMatch(/when p_blocked then 'blocked' else 'in_progress'/);
  });
});

describe("predicates fall back to the legacy literal", () => {
  it("full rows use the category", () => {
    expect(isDone({ status: "todo", status_category: "closed" })).toBe(true);
    expect(isDone({ status: "done", status_category: "active" })).toBe(false);
    expect(isStarted({ status_category: "active" })).toBe(true);
    expect(isBlocked({ status_category: "active", status_blocked: true })).toBe(true);
    expect(isBlocked({ status_category: "active", status_blocked: false, status: "blocked" })).toBe(false);
    expect(isNotStarted({ status_category: "unstarted" })).toBe(true);
  });

  it("legacy rows (mobile / old caches) still answer", () => {
    expect(isDone({ status: "done" })).toBe(true);
    expect(isStarted({ status: "blocked" })).toBe(true);
    expect(isBlocked({ status: "blocked" })).toBe(true);
    expect(isBlocked({ status: "in_progress" })).toBe(false);
    expect(isNotStarted({ status: "todo" })).toBe(true);
    expect(isDone({})).toBe(false);
  });
});

describe("statusForLegacy against the 21-status Maintenance set", () => {
  it("todo → the open status", () => {
    expect(statusForLegacy(MAINTENANCE, "todo")?.name).toBe("requests");
  });
  it("in_progress → the first unblocked active status", () => {
    expect(statusForLegacy(MAINTENANCE, "in_progress")?.name).toBe("preparation");
  });
  it("blocked → the first blocked active status", () => {
    expect(statusForLegacy(MAINTENANCE, "blocked")?.name).toBe("awaiting payment");
  });
  it("done → the closed status", () => {
    expect(statusForLegacy(MAINTENANCE, "done")?.name).toBe("completed");
  });
  it("blocked falls back to an unblocked active status when none is flagged", () => {
    expect(statusForLegacy(DEFAULT.filter((s) => !s.is_blocked), "blocked")?.name).toBe("In progress");
  });
  it("done falls back to a done status when the set has no closed one", () => {
    const noClosed = MAINTENANCE.filter((s) => s.category !== "closed");
    expect(statusForLegacy(noClosed, "done")?.name).toBe("ready for review");
  });
  it("ignores archived rows", () => {
    const archived = MAINTENANCE.map((s) =>
      s.name === "requests" ? { ...s, archived_at: "2026-01-01" } : s,
    );
    expect(statusForLegacy(archived, "todo")).toBeUndefined();
  });
});

describe("remapForSet (list moves)", () => {
  it("keeps category + blocked when the target has a match", () => {
    expect(remapForSet(DEFAULT[2], MAINTENANCE)?.name).toBe("awaiting payment");
    expect(remapForSet(MAINTENANCE[3], DEFAULT)?.name).toBe("In progress");
  });
  it("done → closed, closed → done, unstarted → open", () => {
    expect(remapForSet(MAINTENANCE[18], DEFAULT)?.name).toBe("Done"); // ready for review (done)
    const noClosed = MAINTENANCE.filter((s) => s.category !== "closed");
    expect(remapForSet(DEFAULT[3], noClosed)?.name).toBe("ready for review");
    expect(remapForSet(MAINTENANCE[1], DEFAULT)?.name).toBe("To do");
  });
  it("unknown → open", () => {
    expect(remapForSet({ category: "active", is_blocked: true }, DEFAULT.slice(0, 1))?.name).toBe("To do");
  });
});

describe("resolveStatusInput", () => {
  it("accepts uuid-ish ids, exact names, legacy literals, loose names and unique prefixes", () => {
    const rows = MAINTENANCE.map((s, i) => ({
      ...s,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    expect(resolveStatusInput(rows, rows[5].id)?.name).toBe("quoting");
    expect(resolveStatusInput(rows, "Quote Approval")?.name).toBe("quote approval");
    expect(resolveStatusInput(rows, "done")?.name).toBe("completed");
    expect(resolveStatusInput(rows, "ready_for_review")?.name).toBe("ready for review");
    expect(resolveStatusInput(rows, "procure")?.name).toBe("procurement");
    expect(resolveStatusInput(rows, "budget")).toBeUndefined(); // ambiguous prefix
    expect(resolveStatusInput(rows, "")).toBeUndefined();
  });
});

describe("catalog + board columns", () => {
  const catalog = buildCatalog({
    lists: [
      { id: "l-general", property_id: "p", space_id: null, name: "General", description: null, icon: null, color: "slate", position: 0, status_set_id: "set-default", inherits_statuses: true, is_default: true, archived_at: null },
      { id: "l-maint", property_id: "p", space_id: "sp-fm", name: "Maintenance Request/Work", description: null, icon: null, color: "amber", position: 10, status_set_id: SET, inherits_statuses: false, is_default: false, archived_at: null },
      { id: "l-fm", property_id: "p", space_id: "sp-fm", name: "Tasks", description: null, icon: null, color: "slate", position: 0, status_set_id: "set-default", inherits_statuses: true, is_default: true, archived_at: null },
    ],
    statusSets: [
      { id: "set-default", property_id: "p", name: "Default", is_default: true, archived_at: null },
      { id: SET, property_id: "p", name: "Maintenance", is_default: false, archived_at: null },
    ],
    statuses: [...DEFAULT, ...MAINTENANCE],
  });

  it("orders statuses by position and finds defaults", () => {
    expect(catalog.statusesOfList("l-maint").map((s) => s.name)[0]).toBe("requests");
    expect(catalog.defaultStatusOf("l-maint")?.name).toBe("requests");
    expect(catalog.closedStatusOf("l-maint")?.name).toBe("completed");
    expect(catalog.defaultListOf("sp-fm")?.id).toBe("l-fm");
    expect(catalog.listsOfSpace("sp-fm").map((l) => l.id)).toEqual(["l-fm", "l-maint"]);
    expect(catalog.generalList()?.id).toBe("l-general");
  });

  it("list scope → the pipeline; anything else → category columns", () => {
    const list = columnsFor(catalog, "l-maint");
    expect(list.scope).toBe("list");
    expect(list.columns).toHaveLength(21);
    expect(list.columns[0]).toMatchObject({ label: "requests", category: "open" });
    const all = columnsFor(catalog, null);
    expect(all.scope).toBe("category");
    expect(all.columns).toBe(CATEGORY_COLUMNS);
    expect(columnsFor(catalog, "nope").scope).toBe("category");
  });

  it("columnOfTask: ids in list scope, legacy literals in category scope, category fallback", () => {
    const board = columnsFor(catalog, "l-maint");
    const quoting = MAINTENANCE[5];
    expect(columnOfTask(board, { status_id: quoting.id, status_category: "active", status: "in_progress" })).toBe(quoting.id);
    // A task whose status row is not in this pipeline lands by category.
    expect(columnOfTask(board, { status_id: "st-elsewhere", status_category: "active", status_blocked: true, status: "blocked" })).toBe("st-awaiting-payment");
    const cat = columnsFor(catalog, null);
    expect(columnOfTask(cat, { status_category: "done", status: "done" })).toBe("done");
    expect(columnOfTask(cat, { status_category: "active", status_blocked: true, status: "blocked" })).toBe("blocked");
    expect(columnOfTask(cat, { status: "in_progress" })).toBe("in_progress");
  });
});
