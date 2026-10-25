import { describe, expect, it } from "vitest";
import {
  acceptDefaults,
  describeIntake,
  nextTriageSelection,
  suggestionOutcomes,
  triageAge,
} from "../triage-logic";

describe("describeIntake", () => {
  it("names guest tickets by bot and guest, regardless of source", () => {
    expect(
      describeIntake({
        source: "ai",
        creatorName: null,
        guestTicket: { chatbotName: "Front desk", guestName: "Ana" },
      }),
    ).toEqual({ kind: "guest", label: "Front desk · Ana" });
    expect(
      describeIntake({
        source: "ai",
        creatorName: null,
        guestTicket: { chatbotName: null, guestName: null },
      }).label,
    ).toBe("Guest chatbot");
  });

  it("falls back on source, then the creator", () => {
    expect(describeIntake({ source: "workflow", creatorName: "X", guestTicket: null }).kind).toBe(
      "workflow",
    );
    expect(describeIntake({ source: "ai", creatorName: null, guestTicket: null }).kind).toBe("ai");
    expect(describeIntake({ source: "user", creatorName: "Sam", guestTicket: null })).toEqual({
      kind: "person",
      label: "Sam",
    });
    expect(describeIntake({ source: "user", creatorName: null, guestTicket: null }).label).toBe(
      "Teammate",
    );
  });
});

describe("acceptDefaults", () => {
  const suggestions = [
    { field: "space" as const, suggested_value: "space-ai", status: "pending" },
    { field: "assignee" as const, suggested_value: "user-ai", status: "pending" },
    { field: "priority" as const, suggested_value: "high", status: "pending" },
  ];

  it("fills only EMPTY fields from pending suggestions", () => {
    expect(
      acceptDefaults(
        { space_id: "space-own", assignee_id: null, priority: "none", project_id: null },
        suggestions,
      ),
    ).toEqual({
      spaceId: "space-own",
      assigneeId: "user-ai",
      priority: "high",
      projectId: null,
    });
  });

  it("ignores resolved suggestions", () => {
    expect(
      acceptDefaults(
        { space_id: null, assignee_id: null, priority: "low", project_id: "p" },
        suggestions.map((s) => ({ ...s, status: "auto_applied" })),
      ),
    ).toEqual({ spaceId: null, assigneeId: null, priority: "low", projectId: "p" });
  });
});

describe("suggestionOutcomes", () => {
  const pending = [
    { id: "a", field: "space" as const, suggested_value: "s1" },
    { id: "b", field: "assignee" as const, suggested_value: "u1" },
    { id: "c", field: "priority" as const, suggested_value: "high" },
  ];

  it("accepts suggestions the person ended up choosing", () => {
    expect(
      suggestionOutcomes(pending, { space_id: "s1", assignee_id: "u2", priority: "high" }),
    ).toEqual([
      { id: "a", status: "accepted" },
      { id: "b", status: "dismissed" },
      { id: "c", status: "accepted" },
    ]);
  });

  it("dismisses everything on decline", () => {
    expect(suggestionOutcomes(pending, null).every((o) => o.status === "dismissed")).toBe(true);
  });
});

describe("nextTriageSelection", () => {
  it("selects the row that slides into place", () => {
    expect(nextTriageSelection(["a", "b", "c"], "b")).toBe("c");
    expect(nextTriageSelection(["a", "b", "c"], "a")).toBe("b");
  });
  it("falls back to the new last row, then nothing", () => {
    expect(nextTriageSelection(["a", "b", "c"], "c")).toBe("b");
    expect(nextTriageSelection(["a"], "a")).toBeNull();
    expect(nextTriageSelection(["a", "b"], "zzz")).toBe("a");
  });
});

describe("triageAge", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("compacts ages", () => {
    expect(triageAge("2026-10-25T11:59:40Z", now)).toBe("now");
    expect(triageAge("2026-10-25T11:48:00Z", now)).toBe("12m");
    expect(triageAge("2026-10-25T09:00:00Z", now)).toBe("3h");
    expect(triageAge("2026-10-21T12:00:00Z", now)).toBe("4d");
    expect(triageAge("2026-10-04T12:00:00Z", now)).toBe("3w");
    expect(triageAge("2026-05-25T12:00:00Z", now)).toBe("5mo");
    expect(triageAge("garbage", now)).toBe("");
  });
});
