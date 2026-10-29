import { describe, it, expect } from "vitest";
import {
  duplicateFieldIn,
  insertFieldAt,
  persistableSchema,
  removeFieldFrom,
} from "../builder";
import {
  FormSchemaZod,
  computeVisibleFieldIds,
  formatAnswer,
  parseFormSchema,
  validateAnswers,
  validateFieldAnswer,
  type FormField,
  type FormSchema,
} from "../schema";
import { STARTER_FORMS } from "../templates";

/**
 * The studio builder port (2026-10-25): autosave's persistable-copy rules,
 * the pure field-list edits, the new `consent` type, and the starter forms.
 */

const consent: FormField = {
  id: "agree",
  type: "consent",
  label: "Liability",
  description: "I accept the risks of the activity.",
  required: true,
};

describe("persistableSchema", () => {
  it("drops blank option rows but keeps typed ones", () => {
    const result = persistableSchema({
      version: 1,
      fields: [
        {
          id: "s",
          type: "select",
          label: "Urgency",
          options: [
            { id: "a", label: "Low" },
            { id: "b", label: "" },
            { id: "c", label: "  " },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.schema.fields[0].options).toEqual([{ id: "a", label: "Low" }]);
  });

  it("holds the save when a question has no title", () => {
    const result = persistableSchema({
      version: 1,
      fields: [
        { id: "a", type: "short_text", label: "Name" },
        { id: "b", type: "long_text", label: "   " },
      ],
    });
    expect(result).toMatchObject({ ok: false, fieldId: "b" });
    if (!result.ok) expect(result.reason).toMatch(/Question 2/);
  });

  it("produces a schema the server action accepts", () => {
    const result = persistableSchema({ version: 1, fields: [consent] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(FormSchemaZod.safeParse(result.schema).success).toBe(true);
  });
});

describe("field list edits", () => {
  const fields: FormField[] = [
    { id: "a", type: "yes_no", label: "Gate" },
    {
      id: "b",
      type: "select",
      label: "Pick",
      options: [{ id: "o1", label: "One" }],
      condition: { fieldId: "a", op: "equals", value: "yes" },
    },
  ];

  it("inserts at a clamped index", () => {
    const f: FormField = { id: "n", type: "short_text", label: "New" };
    expect(insertFieldAt(fields, 1, f).map((x) => x.id)).toEqual(["a", "n", "b"]);
    expect(insertFieldAt(fields, 99, f).map((x) => x.id)).toEqual(["a", "b", "n"]);
    expect(insertFieldAt(fields, -3, f).map((x) => x.id)).toEqual(["n", "a", "b"]);
  });

  it("duplicates right after the original with fresh ids", () => {
    const { fields: next, copyId } = duplicateFieldIn(fields, "b");
    expect(next).toHaveLength(3);
    expect(next[2].id).toBe(copyId);
    expect(next[2].label).toBe("Pick (copy)");
    expect(next[2].options?.[0].id).not.toBe("o1");
    expect(next[2].condition).toEqual(fields[1].condition);
  });

  it("keeps semantic option ids on task-property copies", () => {
    const prio: FormField = {
      id: "p",
      type: "select",
      label: "Priority",
      taskProperty: "priority",
      options: [{ id: "urgent", label: "Urgent" }],
    };
    const { fields: next } = duplicateFieldIn([prio], "p");
    expect(next[1].options?.[0].id).toBe("urgent");
  });

  it("removing a controller drops the conditions that pointed at it", () => {
    const next = removeFieldFrom(fields, "a");
    expect(next.map((f) => f.id)).toEqual(["b"]);
    expect(next[0].condition).toBeUndefined();
  });
});

describe("consent fields", () => {
  const schema: FormSchema = { version: 1, fields: [consent] };

  it("parses alongside legacy forms", () => {
    expect(parseFormSchema(schema).fields[0].type).toBe("consent");
  });

  it("a required consent only validates when ticked", () => {
    expect(validateFieldAnswer(consent, undefined)).toBe("Tick the box to agree");
    expect(validateFieldAnswer(consent, false)).toBe("Tick the box to agree");
    expect(validateFieldAnswer(consent, true)).toBeNull();
    expect(validateAnswers(schema, { agree: true })).toEqual({
      ok: true,
      answers: { agree: true },
    });
  });

  it("an optional consent may be left unticked", () => {
    const optional = { ...consent, required: false };
    expect(validateFieldAnswer(optional, undefined)).toBeNull();
    expect(validateFieldAnswer(optional, false)).toBeNull();
    expect(validateFieldAnswer(optional, "yes")).toBe("Tick the box to agree");
  });

  it("formats for tables and workflow payloads", () => {
    expect(formatAnswer(consent, true)).toBe("Agreed");
    expect(formatAnswer(consent, false)).toBe("Not agreed");
  });

  it("can gate a later question", () => {
    const gated: FormSchema = {
      version: 1,
      fields: [
        { ...consent, required: false },
        {
          id: "why",
          type: "long_text",
          label: "Why not?",
          condition: { fieldId: "agree", op: "not_answered" },
        },
      ],
    };
    expect(computeVisibleFieldIds(gated, {}).has("why")).toBe(true);
    expect(computeVisibleFieldIds(gated, { agree: true }).has("why")).toBe(false);
  });
});

describe("starter forms", () => {
  it.each(STARTER_FORMS.map((s) => [s.key, s] as const))(
    "%s is a valid schema with unique field ids",
    (_key, starter) => {
      expect(FormSchemaZod.safeParse(starter.schema).success).toBe(true);
      const ids = starter.schema.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Conditions only ever reference an EARLIER field.
      starter.schema.fields.forEach((f, i) => {
        if (!f.condition) return;
        expect(ids.slice(0, i)).toContain(f.condition.fieldId);
      });
    },
  );
});
