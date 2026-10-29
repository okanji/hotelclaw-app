import { describe, expect, it } from "vitest";
import {
  checklistCounts,
  nestItems,
  parseChecklistText,
  positionBetween,
  progressFor,
} from "../checklist-progress";

describe("checklist helpers", () => {
  it("nests one level in position order and keeps orphans", () => {
    const items = [
      { id: "b", parent_item_id: null, position: 2048, done: false },
      { id: "a", parent_item_id: null, position: 1024, done: true },
      { id: "a2", parent_item_id: "a", position: 2048, done: false },
      { id: "a1", parent_item_id: "a", position: 1024, done: false },
      { id: "x", parent_item_id: "gone", position: 1, done: false },
    ];
    const n = nestItems(items);
    expect(n.map((i) => i.id)).toEqual(["a", "b", "x"]);
    expect(n[0]!.children.map((c) => c.id)).toEqual(["a1", "a2"]);
  });
  it("counts and progress", () => {
    expect(checklistCounts([{ done: true }, { done: false }])).toEqual({ done: 1, total: 2 });
    expect(progressFor({ subIssuesDone: 1, subIssuesTotal: 2, checklistDone: 2, checklistTotal: 2 })).toEqual({
      done: 3,
      total: 4,
      pct: 75,
    });
    expect(progressFor({ subIssuesDone: 0, subIssuesTotal: 0 })).toBeNull();
  });
  it("positions between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(2048, null)).toBe(3072);
  });
  it("parses a pasted list: bullets, ticks, indentation", () => {
    expect(parseChecklistText("- [x] Keys\n  - Spare set\n2. Radios\n\n\t[ ] Batteries\nFloat")).toEqual([
      { text: "Keys", done: true, children: [{ text: "Spare set", done: false }] },
      { text: "Radios", done: false, children: [{ text: "Batteries", done: false }] },
      { text: "Float", done: false, children: [] },
    ]);
  });
});
