import { describe, expect, it } from "vitest";
import { coerceFieldValue, normalizeUrl, parseLooseNumber } from "../field-coerce";
import { formatCurrency, formatFieldValue } from "../custom-field-options";

const f = (type: Parameters<typeof coerceFieldValue>[0]["type"], extra = {}) => ({
  name: "F",
  type,
  ...extra,
});
const val = (r: ReturnType<typeof coerceFieldValue>) => (r.ok ? r.value : `ERR:${r.error}`);

describe("coerceFieldValue", () => {
  it("clears on empty input for every writable type", () => {
    for (const t of ["text", "number", "currency", "people", "relation", "url"] as const) {
      expect(val(coerceFieldValue(f(t), ""))).toBeNull();
      expect(val(coerceFieldValue(f(t), null))).toBeNull();
    }
  });
  it("rejects computed types", () => {
    expect(coerceFieldValue(f("progress"), 3).ok).toBe(false);
    expect(coerceFieldValue(f("files"), ["x"]).ok).toBe(false);
  });
  it("rounds currency to the configured precision and reads loose amounts", () => {
    expect(val(coerceFieldValue(f("currency", { config: { code: "KES", precision: 0 } }), "1,250.6"))).toBe(1251);
    expect(val(coerceFieldValue(f("currency", { config: { code: "USD" } }), "$ 3.456"))).toBe(3.46);
    expect(val(coerceFieldValue(f("currency"), "KES 12 000"))).toBe(12000);
    expect(coerceFieldValue(f("currency"), "lots").ok).toBe(false);
  });
  it("numbers stay plain decimals", () => {
    expect(val(coerceFieldValue(f("number"), "0x10"))).toMatch(/^ERR/);
    expect(val(coerceFieldValue(f("number"), "42"))).toBe(42);
  });
  it("prefixes a scheme on links and rejects non-web schemes", () => {
    expect(val(coerceFieldValue(f("url"), "example.com/q"))).toBe("https://example.com/q");
    expect(coerceFieldValue(f("url"), "javascript:alert(1)").ok).toBe(false);
    expect(normalizeUrl("notalink")).toBeNull();
  });
  it("validates email and phone", () => {
    expect(val(coerceFieldValue(f("email"), " Ana@Hotel.com "))).toBe("ana@hotel.com");
    expect(coerceFieldValue(f("email"), "ana@").ok).toBe(false);
    expect(val(coerceFieldValue(f("phone"), "+254 700 000 000"))).toBe("+254 700 000 000");
    expect(coerceFieldValue(f("phone"), "12").ok).toBe(false);
  });
  it("resolves people by id, exact name or partial name", () => {
    const members = [
      { id: "11111111-1111-1111-1111-111111111111", name: "Patrick Otieno" },
      { id: "22222222-2222-2222-2222-222222222222", name: "Lennox Kamau" },
    ];
    expect(val(coerceFieldValue(f("people"), "Patrick, lennox", { members }))).toEqual([
      members[0]!.id,
      members[1]!.id,
    ]);
    expect(val(coerceFieldValue(f("people"), [members[1]!.id], { members }))).toEqual([members[1]!.id]);
    expect(coerceFieldValue(f("people"), "Zed", { members }).ok).toBe(false);
    expect(
      coerceFieldValue(f("people", { config: { multiple: false } }), "Patrick, Lennox", { members }).ok,
    ).toBe(false);
  });
  it("resolves relations by key or exact title and honours the target list", () => {
    const tasks = [
      { id: "33333333-3333-3333-3333-333333333333", title: "Fix pump", key: "GHV-12", list_id: "L1" },
      { id: "44444444-4444-4444-4444-444444444444", title: "Order seal", key: "GHV-13", list_id: "L2" },
    ];
    expect(val(coerceFieldValue(f("relation"), "ghv-12", { tasks }))).toEqual([tasks[0]!.id]);
    expect(val(coerceFieldValue(f("relation"), "Order seal", { tasks }))).toEqual([tasks[1]!.id]);
    expect(
      coerceFieldValue(f("relation", { config: { target_list_id: "L1" } }), "GHV-13", { tasks }).ok,
    ).toBe(false);
  });
  it("matches options by label and keeps label arrays canonical", () => {
    const options = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    expect(val(coerceFieldValue(f("select", { options }), "beta"))).toBe("b");
    expect(val(coerceFieldValue(f("multi_select", { options }), "Beta, Alpha"))).toEqual(["a", "b"]);
    expect(coerceFieldValue(f("select", { options }), "Gamma").ok).toBe(false);
  });
  it("dates accept a timestamp's calendar day", () => {
    expect(val(coerceFieldValue(f("date"), "2026-10-29T08:00:00Z"))).toBe("2026-10-29");
    expect(coerceFieldValue(f("date"), "tomorrow").ok).toBe(false);
  });
  it("checkbox reads words", () => {
    expect(val(coerceFieldValue(f("checkbox"), "Yes"))).toBe(true);
    expect(val(coerceFieldValue(f("checkbox"), "off"))).toBe(false);
  });
});

describe("parseLooseNumber / formatting", () => {
  it("parses", () => {
    expect(parseLooseNumber("-1,000.5")).toBe(-1000.5);
    expect(parseLooseNumber("1e9")).toBeNull();
  });
  it("formats currency and ref lists", () => {
    expect(formatCurrency(1250, { code: "KES", precision: 2 })).toBe("KES 1,250.00");
    expect(
      formatFieldValue({ type: "people", options: [] }, ["a", "b"], { names: { a: { name: "Ana" } } }),
    ).toBe("2 people");
    expect(
      formatFieldValue({ type: "relation", options: [] }, ["t"], { taskTitles: { t: "Fix pump" } }),
    ).toBe("Fix pump");
  });
});
