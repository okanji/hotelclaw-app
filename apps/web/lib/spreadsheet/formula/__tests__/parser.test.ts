/**
 * Formula engine smoke tests. Covers tokenizer + parser + evaluator on the
 * features we ship in Phase 3:
 *   - arithmetic precedence and unary
 *   - parens
 *   - string literals + & concat
 *   - all 6 comparison operators
 *   - IF / IFERROR / IFS / SWITCH branching
 *   - range expansion (`colA@row1:colA@row5`)
 *   - named ranges (`Revenue`)
 *   - cycle detection
 *   - SUM / AVG / COUNT / MIN / MAX over ranges
 *   - VLOOKUP basic
 *   - DATE / YEAR / MONTH
 *   - LEFT / RIGHT / MID
 */

import { describe, expect, test } from "vitest";
import { evaluateCellGraph, evaluateExpression, type GridShape } from "..";

const shape: GridShape = {
  columnIds: ["colA", "colB", "colC", "colD"],
  rowIds: ["row1", "row2", "row3", "row4", "row5"],
};

/** Build a one-step evaluator with a fixed cells map. */
function evalAt(
  expression: string,
  cells: Record<string, string> = {},
  options?: { shape?: GridShape },
) {
  const graph = evaluateCellGraph(
    { ...cells, target: expression },
    options?.shape ?? shape,
  );
  return graph.get("target");
}

describe("arithmetic + precedence", () => {
  test("plain number", () => {
    expect(evalAt("=1+2")).toEqual({ type: "number", value: 3 });
  });
  test("precedence", () => {
    expect(evalAt("=1+2*3")).toEqual({ type: "number", value: 7 });
  });
  test("parens", () => {
    expect(evalAt("=(1+2)*3")).toEqual({ type: "number", value: 9 });
  });
  test("unary minus", () => {
    // Excel/Sheets convention: unary `-` binds *tighter* than `^`, so
    // `-2^2` = `(-2)^2` = 4. We follow that.
    expect(evalAt("=-2^2")).toEqual({ type: "number", value: 4 });
  });
  test("unary minus on number-only", () => {
    expect(evalAt("=-(5)")).toEqual({ type: "number", value: -5 });
  });
  test("exponent right-assoc", () => {
    expect(evalAt("=2^3^2")).toEqual({ type: "number", value: 512 });
  });
  test("division by zero", () => {
    expect(evalAt("=1/0")?.type).toBe("error");
  });
});

describe("strings + concat", () => {
  test("string literal", () => {
    expect(evalAt('="hello"')).toEqual({ type: "string", value: "hello" });
  });
  test("& concat", () => {
    expect(evalAt('="a"&"b"')).toEqual({ type: "string", value: "ab" });
  });
  test("+ implicit concat", () => {
    expect(evalAt('="a"+1')).toEqual({ type: "string", value: "a1" });
  });
});

describe("comparison operators", () => {
  test("equals", () => {
    expect(evalAt("=1=1")).toEqual({ type: "boolean", value: true });
  });
  test("not equals", () => {
    expect(evalAt("=1<>2")).toEqual({ type: "boolean", value: true });
  });
  test("less than", () => {
    expect(evalAt("=1<2")).toEqual({ type: "boolean", value: true });
  });
  test("greater than", () => {
    expect(evalAt("=2>1")).toEqual({ type: "boolean", value: true });
  });
  test("less or equal", () => {
    expect(evalAt("=2<=2")).toEqual({ type: "boolean", value: true });
  });
  test("greater or equal", () => {
    expect(evalAt("=2>=3")).toEqual({ type: "boolean", value: false });
  });
});

describe("logical functions", () => {
  test("IF true branch", () => {
    expect(evalAt('=IF(1>0, "yes", "no")')).toEqual({
      type: "string",
      value: "yes",
    });
  });
  test("IF false branch", () => {
    expect(evalAt('=IF(1>2, "yes", "no")')).toEqual({
      type: "string",
      value: "no",
    });
  });
  test("IFERROR catches", () => {
    expect(evalAt('=IFERROR(1/0, "div")')).toEqual({
      type: "string",
      value: "div",
    });
  });
  test("IFS picks first true", () => {
    expect(evalAt('=IFS(FALSE, "a", TRUE, "b", TRUE, "c")')).toEqual({
      type: "string",
      value: "b",
    });
  });
  test("SWITCH matches", () => {
    expect(evalAt('=SWITCH(2, 1, "one", 2, "two", "other")')).toEqual({
      type: "string",
      value: "two",
    });
  });
  test("SWITCH default", () => {
    expect(evalAt('=SWITCH(99, 1, "one", 2, "two", "other")')).toEqual({
      type: "string",
      value: "other",
    });
  });
  test("AND / OR / NOT", () => {
    expect(evalAt("=AND(TRUE, TRUE)")).toEqual({ type: "boolean", value: true });
    expect(evalAt("=OR(FALSE, TRUE)")).toEqual({ type: "boolean", value: true });
    expect(evalAt("=NOT(TRUE)")).toEqual({ type: "boolean", value: false });
  });
});

describe("range expansion + aggregators", () => {
  const cells = {
    "colA@row1": "1",
    "colA@row2": "2",
    "colA@row3": "3",
    "colA@row4": "4",
    "colA@row5": "5",
  };
  test("SUM(range)", () => {
    expect(
      evalAt("=SUM(colA@row1:colA@row5)", cells),
    ).toEqual({ type: "number", value: 15 });
  });
  test("AVERAGE(range)", () => {
    expect(
      evalAt("=AVERAGE(colA@row1:colA@row5)", cells),
    ).toEqual({ type: "number", value: 3 });
  });
  test("COUNT(range)", () => {
    expect(
      evalAt("=COUNT(colA@row1:colA@row5)", cells),
    ).toEqual({ type: "number", value: 5 });
  });
  test("MIN / MAX", () => {
    expect(evalAt("=MIN(colA@row1:colA@row5)", cells)).toEqual({
      type: "number",
      value: 1,
    });
    expect(evalAt("=MAX(colA@row1:colA@row5)", cells)).toEqual({
      type: "number",
      value: 5,
    });
  });
  test("non-numeric skipped in SUM", () => {
    const mixed = { ...cells, "colA@row3": "hello" };
    expect(evalAt("=SUM(colA@row1:colA@row5)", mixed)).toEqual({
      type: "number",
      value: 12,
    });
  });
});

describe("named ranges", () => {
  test("named range resolves via shape.namedRanges", () => {
    const shapeWithName: GridShape = {
      ...shape,
      namedRanges: {
        Revenue: { sheetId: "s1", startRef: "colA@row1", endRef: "colA@row5" },
      },
    };
    expect(
      evalAt(
        "=SUM(Revenue)",
        {
          "colA@row1": "10",
          "colA@row2": "20",
          "colA@row3": "30",
        },
        { shape: shapeWithName },
      ),
    ).toEqual({ type: "number", value: 60 });
  });
  test("unknown named range errors", () => {
    expect(evalAt("=SUM(Unknown)")?.type).toBe("error");
  });
  test("named range lookup is case-insensitive", () => {
    const shapeWithName: GridShape = {
      ...shape,
      namedRanges: {
        Revenue: { sheetId: "s1", startRef: "colA@row1", endRef: "colA@row3" },
      },
    };
    expect(
      evalAt(
        "=SUM(REVENUE)",
        { "colA@row1": "10", "colA@row2": "20", "colA@row3": "30" },
        { shape: shapeWithName },
      ),
    ).toEqual({ type: "number", value: 60 });
    expect(
      evalAt(
        "=SUM(revenue)",
        { "colA@row1": "10", "colA@row2": "20", "colA@row3": "30" },
        { shape: shapeWithName },
      ),
    ).toEqual({ type: "number", value: 60 });
  });
  test("named range pointing to refs outside active shape returns error", () => {
    // Simulates a cross-sheet ref — the named range's startRef uses a
    // column id that isn't in the active shape, so the lookup must surface
    // an error rather than silently aggregating to zero.
    const shapeWithName: GridShape = {
      ...shape,
      namedRanges: {
        OtherSheet: {
          sheetId: "s2",
          startRef: "unknownCol@unknownRow",
          endRef: "unknownCol@unknownRow",
        },
      },
    };
    expect(
      evalAt("=SUM(OtherSheet)", {}, { shape: shapeWithName })?.type,
    ).toBe("error");
  });
});

describe("cycle detection", () => {
  test("self-ref", () => {
    expect(evalAt("=colA@row1", { "colA@row1": "=colA@row1" })?.type).toBe(
      "error",
    );
  });
});

describe("text functions", () => {
  test("LEFT / RIGHT / MID", () => {
    expect(evalAt('=LEFT("hello", 3)')).toEqual({ type: "string", value: "hel" });
    expect(evalAt('=RIGHT("hello", 2)')).toEqual({ type: "string", value: "lo" });
    expect(evalAt('=MID("hello", 2, 3)')).toEqual({
      type: "string",
      value: "ell",
    });
  });
  test("TRIM collapses whitespace", () => {
    expect(evalAt('=TRIM("  a  b  ")')).toEqual({
      type: "string",
      value: "a b",
    });
  });
  test("UPPER / LOWER", () => {
    expect(evalAt('=UPPER("hello")')).toEqual({ type: "string", value: "HELLO" });
    expect(evalAt('=LOWER("WORLD")')).toEqual({ type: "string", value: "world" });
  });
});

describe("date functions", () => {
  test("DATE", () => {
    // DATE(2024, 1, 1) should be a positive serial.
    const r = evalAt("=DATE(2024, 1, 1)");
    expect(r?.type).toBe("number");
    if (r?.type === "number") {
      expect(r.value).toBeGreaterThan(40000);
    }
  });
  test("YEAR / MONTH / DAY", () => {
    expect(evalAt("=YEAR(DATE(2024, 6, 15))")).toEqual({
      type: "number",
      value: 2024,
    });
    expect(evalAt("=MONTH(DATE(2024, 6, 15))")).toEqual({
      type: "number",
      value: 6,
    });
    expect(evalAt("=DAY(DATE(2024, 6, 15))")).toEqual({
      type: "number",
      value: 15,
    });
  });
});

describe("VLOOKUP", () => {
  test("exact match", () => {
    const cells = {
      "colA@row1": "apple",
      "colB@row1": "10",
      "colA@row2": "banana",
      "colB@row2": "20",
      "colA@row3": "cherry",
      "colB@row3": "30",
    };
    expect(
      evalAt(
        '=VLOOKUP("banana", colA@row1:colB@row3, 2, FALSE)',
        cells,
      ),
    ).toEqual({ type: "number", value: 20 });
  });
});
