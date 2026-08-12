import { describe, it, expect } from "vitest";
import {
  computeTaskProperties,
  computeVisibleFieldIds,
  parseFormSchema,
  validateAnswers,
  visibleInputFields,
  type FormSchema,
} from "../schema";

/**
 * Conditional visibility + task-property mapping — the two behaviors that
 * MUST agree between the client renderer and the server submission path
 * (both call the same functions, so these tests pin the shared truth).
 */

const SCHEMA: FormSchema = {
  version: 1,
  fields: [
    {
      id: "kind",
      type: "select",
      label: "What kind of issue?",
      required: true,
      options: [
        { id: "plumbing", label: "Plumbing" },
        { id: "electrical", label: "Electrical" },
      ],
    },
    {
      id: "room",
      type: "short_text",
      label: "Which room?",
      required: true,
      condition: { fieldId: "kind", op: "equals", value: "plumbing" },
    },
    {
      id: "cascade",
      type: "short_text",
      label: "Water damage details",
      condition: { fieldId: "room", op: "answered" },
    },
    { id: "always", type: "short_text", label: "Anything else?" },
  ],
};

describe("computeVisibleFieldIds", () => {
  it("hides a field whose condition doesn't hold", () => {
    const visible = computeVisibleFieldIds(SCHEMA, { kind: "electrical" });
    expect(visible.has("room")).toBe(false);
    expect(visible.has("always")).toBe(true);
  });

  it("shows the field when the condition holds, and cascades", () => {
    expect(computeVisibleFieldIds(SCHEMA, { kind: "plumbing" }).has("room")).toBe(true);
    // room visible but unanswered → cascade keeps water-damage hidden
    expect(
      computeVisibleFieldIds(SCHEMA, { kind: "plumbing" }).has("cascade"),
    ).toBe(false);
    expect(
      computeVisibleFieldIds(SCHEMA, { kind: "plumbing", room: "204" }).has("cascade"),
    ).toBe(true);
  });

  it("cascades hidden controllers: hidden parent hides the child even if answered", () => {
    const visible = computeVisibleFieldIds(SCHEMA, {
      kind: "electrical",
      room: "204",
    });
    expect(visible.has("cascade")).toBe(false);
  });

  it("fails open when the controller was deleted", () => {
    const broken: FormSchema = {
      version: 1,
      fields: [
        {
          id: "orphan",
          type: "short_text",
          label: "Orphan",
          condition: { fieldId: "gone", op: "equals", value: "x" },
        },
      ],
    };
    expect(computeVisibleFieldIds(broken, {}).has("orphan")).toBe(true);
  });
});

describe("validateAnswers with conditions", () => {
  it("never blocks on a hidden required field, and drops its stale answer", () => {
    const result = validateAnswers(SCHEMA, {
      kind: "electrical",
      room: "stale answer from before the switch",
      always: "note",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answers).toEqual({ kind: "electrical", always: "note" });
    }
  });

  it("still requires a visible required field", () => {
    const result = validateAnswers(SCHEMA, { kind: "plumbing" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.room).toBeTruthy();
  });
});

describe("computeTaskProperties", () => {
  const mapped: FormSchema = {
    version: 1,
    fields: [
      { id: "who", type: "people", label: "Assignee", taskProperty: "assignee" },
      {
        id: "prio",
        type: "select",
        label: "Priority",
        taskProperty: "priority",
        options: [
          { id: "urgent", label: "Urgent" },
          { id: "high", label: "High" },
          { id: "medium", label: "Medium" },
          { id: "low", label: "Low" },
        ],
      },
      { id: "due", type: "date", label: "Due date", taskProperty: "due_date" },
      {
        id: "tags",
        type: "multi_select",
        label: "Tags",
        taskProperty: "labels",
        options: [
          { id: "t1", label: "Maintenance" },
          { id: "t2", label: "Urgent fix" },
        ],
      },
    ],
  };

  it("maps answered properties, resolving option ids to labels for tags", () => {
    expect(
      computeTaskProperties(mapped, {
        who: "user-123",
        prio: "high",
        due: "2026-09-01",
        tags: ["t1", "t2"],
      }),
    ).toEqual({
      assignee_id: "user-123",
      priority: "high",
      due_at: "2026-09-01",
      labels: ["Maintenance", "Urgent fix"],
    });
  });

  it("prefers server-resolved labels (sourced fields) over option labels", () => {
    const resolved = new Map([["tags", new Map([["t1", "Catalog Name"]])]]);
    expect(
      computeTaskProperties(mapped, { tags: ["t1"] }, resolved).labels,
    ).toEqual(["Catalog Name"]);
  });

  it("yields nulls/empty for unanswered or invalid values", () => {
    expect(computeTaskProperties(mapped, { prio: "not-a-priority" })).toEqual({
      assignee_id: null,
      priority: null,
      due_at: null,
      labels: [],
    });
  });

  it("ignores mapped answers on conditionally hidden fields", () => {
    const conditional: FormSchema = {
      version: 1,
      fields: [
        {
          id: "gate",
          type: "yes_no",
          label: "Assign now?",
        },
        {
          id: "who",
          type: "people",
          label: "Assignee",
          taskProperty: "assignee",
          condition: { fieldId: "gate", op: "equals", value: "yes" },
        },
      ],
    };
    expect(
      computeTaskProperties(conditional, { gate: false, who: "user-123" }).assignee_id,
    ).toBeNull();
    expect(
      computeTaskProperties(conditional, { gate: true, who: "user-123" }).assignee_id,
    ).toBe("user-123");
  });
});

describe("parseFormSchema with new keys", () => {
  it("round-trips settings and new field types", () => {
    const schema = parseFormSchema({
      version: 1,
      fields: [
        { id: "a", type: "signature", label: "Sign here" },
        { id: "b", type: "info", label: "We reply within 5 business days." },
        { id: "c", type: "people", label: "Manager" },
      ],
      settings: {
        submitLabel: "Send request",
        layout: "two",
        background: "sage",
        redirectUrl: "not a url but must not wipe the form",
      },
    });
    expect(schema.fields).toHaveLength(3);
    expect(schema.settings?.submitLabel).toBe("Send request");
    // Layout blocks collect no input.
    expect(visibleInputFields(schema, {}).map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("still parses a legacy schema without the new keys", () => {
    const schema = parseFormSchema({
      version: 1,
      fields: [{ id: "x", type: "short_text", label: "Name" }],
    });
    expect(schema.fields).toHaveLength(1);
  });
});
