import { describe, expect, it } from "vitest";
import { applySchemaDiff, diffFormSchemas } from "../ai-edit-diff";
import type { FormField, FormSchema } from "../schema";

function field(id: string, patch: Partial<FormField> = {}): FormField {
  return { id, type: "short_text", label: `Question ${id}`, ...patch };
}

function schema(fields: FormField[], settings?: FormSchema["settings"]): FormSchema {
  return { version: 1, fields, settings };
}

describe("diffFormSchemas", () => {
  it("reports identical schemas as all unchanged", () => {
    const current = schema([field("a"), field("b")]);
    const proposed = schema([field("a"), field("b")]);
    const diff = diffFormSchemas(current, proposed);
    expect(diff.entries).toEqual([]);
    expect(diff.unchangedCount).toBe(2);
    expect(diff.orderChanged).toBe(false);
  });

  it("classifies added, removed, modified, and unchanged by field id", () => {
    const current = schema([
      field("a"),
      field("b", { label: "Room number" }),
      field("c"),
    ]);
    const proposed = schema([
      field("a"),
      field("b", { label: "Room", required: true }),
      field("new1", { type: "select", label: "Priority", options: [{ id: "hi", label: "High" }] }),
    ]);
    const diff = diffFormSchemas(current, proposed);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.entries.map((e) => [e.kind, e.id])).toEqual([
      ["modified", "b"],
      ["added", "new1"],
      ["removed", "c"],
    ]);
    const modified = diff.entries.find((e) => e.kind === "modified");
    expect(modified && modified.kind === "modified" ? modified.changed : []).toEqual([
      "label",
      "required",
    ]);
  });

  it("names type and options changes, and falls back to details", () => {
    const current = schema([
      field("a", { type: "select", options: [{ id: "x", label: "X" }] }),
      field("b", { description: "old" }),
    ]);
    const proposed = schema([
      field("a", { type: "multi_select", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }),
      field("b", { description: "new" }),
    ]);
    const diff = diffFormSchemas(current, proposed);
    const byId = new Map(diff.entries.map((e) => [e.id, e]));
    const a = byId.get("a");
    const b = byId.get("b");
    expect(a?.kind === "modified" ? a.changed : []).toEqual(["type", "options"]);
    expect(b?.kind === "modified" ? b.changed : []).toEqual(["details"]);
  });

  it("treats undefined and absent config as equal (no phantom modifications)", () => {
    const current = schema([field("a", { required: undefined, placeholder: undefined })]);
    const proposed = schema([field("a")]);
    const diff = diffFormSchemas(current, proposed);
    expect(diff.entries).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("flags a pure reorder of kept fields", () => {
    const current = schema([field("a"), field("b")]);
    const proposed = schema([field("b"), field("a")]);
    const diff = diffFormSchemas(current, proposed);
    expect(diff.entries).toEqual([]);
    expect(diff.orderChanged).toBe(true);
  });
});

describe("applySchemaDiff", () => {
  const current = schema(
    [field("a"), field("b", { label: "Room number" }), field("c"), field("d")],
    { submitLabel: "Send" },
  );
  const proposed = schema([
    field("b", { label: "Room", required: true }),
    field("a"),
    field("new1", { label: "Priority" }),
  ]);
  // Diff: modified b, added new1, removed c, removed d; a unchanged (reordered).

  it("applies everything when all changes are included", () => {
    const out = applySchemaDiff(current, proposed, new Set(["b", "new1", "c", "d"]));
    expect(out.fields.map((f) => f.id)).toEqual(["b", "a", "new1"]);
    expect(out.fields[0].label).toBe("Room");
    expect(out.fields[0].required).toBe(true);
  });

  it("returns the current schema when nothing is included and order kept", () => {
    const cur = schema([field("a"), field("b")], { submitLabel: "Send" });
    const prop = schema([field("a"), field("b", { label: "Changed" }), field("new1")]);
    const out = applySchemaDiff(cur, prop, new Set());
    expect(out).toEqual(cur);
  });

  it("keeps the current version of a field whose modification is excluded", () => {
    const out = applySchemaDiff(current, proposed, new Set(["new1", "c", "d"]));
    const b = out.fields.find((f) => f.id === "b");
    expect(b?.label).toBe("Room number");
    expect(b?.required).toBeUndefined();
  });

  it("skips an excluded addition", () => {
    const out = applySchemaDiff(current, proposed, new Set(["b", "c", "d"]));
    expect(out.fields.some((f) => f.id === "new1")).toBe(false);
  });

  it("re-inserts excluded removals after their surviving predecessor", () => {
    // Removals of c and d both excluded: they follow b in the current order,
    // and b survives — c then d slot back in after it, in their old order.
    const out = applySchemaDiff(current, proposed, new Set(["b", "new1"]));
    expect(out.fields.map((f) => f.id)).toEqual(["b", "c", "d", "a", "new1"]);
    // Their content is byte-identical to the current schema's.
    expect(out.fields.find((f) => f.id === "c")).toEqual(field("c"));
  });

  it("re-inserts an excluded removal at the front when it led the form", () => {
    const cur = schema([field("lead"), field("a")]);
    const prop = schema([field("a")]);
    const out = applySchemaDiff(cur, prop, new Set());
    expect(out.fields.map((f) => f.id)).toEqual(["lead", "a"]);
  });

  it("preserves current settings", () => {
    const out = applySchemaDiff(current, proposed, new Set(["b", "new1", "c", "d"]));
    expect(out.settings).toEqual({ submitLabel: "Send" });
  });
});
