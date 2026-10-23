import { describe, expect, it } from "vitest";
import {
  activityScopeKey,
  matchesFamily,
  type ActivityLogRow,
} from "../activity-log-queries";

function row(partial: Partial<ActivityLogRow>): ActivityLogRow {
  return {
    id: "r1",
    property_id: "p1",
    actor_id: "u1",
    actor_kind: "user",
    entity_kind: "task",
    entity_id: "t1",
    entity_title: "Fix the boiler",
    verb: "created",
    detail: {},
    project_id: null,
    space_id: null,
    created_at: "2026-10-23T10:00:00Z",
    ...partial,
  };
}

describe("activity log filter families", () => {
  it("files task lifecycle verbs under status, assignments and dates", () => {
    expect(matchesFamily(row({ verb: "completed" }), "status")).toBe(true);
    expect(matchesFamily(row({ verb: "priority_changed" }), "status")).toBe(true);
    expect(matchesFamily(row({ verb: "assigned" }), "assignments")).toBe(true);
    expect(matchesFamily(row({ verb: "unassigned" }), "assignments")).toBe(true);
    expect(matchesFamily(row({ verb: "due_changed" }), "dates")).toBe(true);
    expect(matchesFamily(row({ verb: "scheduled" }), "dates")).toBe(true);
    expect(matchesFamily(row({ verb: "assigned" }), "status")).toBe(false);
  });

  it("treats project and milestone rows as project activity", () => {
    expect(
      matchesFamily(row({ entity_kind: "project", verb: "status_changed" }), "projects"),
    ).toBe(true);
    expect(
      matchesFamily(row({ entity_kind: "milestone", verb: "milestone_added" }), "projects"),
    ).toBe(true);
    // A milestone reached is also a dated event.
    expect(
      matchesFamily(row({ entity_kind: "milestone", verb: "milestone_completed" }), "dates"),
    ).toBe(true);
    // A task moving between projects shows in the project family too.
    expect(matchesFamily(row({ verb: "project_changed" }), "projects")).toBe(true);
    // But a project's own status change is not a TASK status change.
    expect(
      matchesFamily(row({ entity_kind: "project", verb: "status_changed" }), "status"),
    ).toBe(false);
  });

  it("'all' matches everything and 'created' covers creation + deletion", () => {
    expect(matchesFamily(row({ verb: "anything" }), "all")).toBe(true);
    expect(matchesFamily(row({ verb: "deleted" }), "created")).toBe(true);
    expect(matchesFamily(row({ verb: "renamed" }), "created")).toBe(false);
  });
});

describe("activity scope keys", () => {
  it("are stable per scope so React Query caches don't collide", () => {
    expect(activityScopeKey({ kind: "property" })).toBe("property");
    expect(activityScopeKey({ kind: "project", id: "a" })).toBe("project:a");
    expect(activityScopeKey({ kind: "task", id: "a" })).toBe("task:a");
    expect(activityScopeKey({ kind: "project", id: "a" })).not.toBe(
      activityScopeKey({ kind: "space", id: "a" }),
    );
  });
});
