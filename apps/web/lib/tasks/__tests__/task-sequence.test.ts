import { describe, expect, it } from "vitest";
import { resolveTaskSequence } from "../task-sequence";

const ORDER = ["todo", "in_progress", "blocked", "done"];

const tasks = [
  { id: "d1", status: "done", position: 1 },
  { id: "t2", status: "todo", position: 2048 },
  { id: "t1", status: "todo", position: 1024 },
  { id: "p1", status: "in_progress", position: 5 },
  { id: "s2", status: "todo", position: 2, parent_id: "t1" },
  { id: "s1", status: "done", position: 1, parent_id: "t1" },
];

describe("resolveTaskSequence", () => {
  it("walks top-level tasks in column then position order", () => {
    expect(resolveTaskSequence(tasks, "t1", ORDER)).toEqual({
      prevId: null,
      nextId: "t2",
      index: 0,
      total: 4,
    });
    expect(resolveTaskSequence(tasks, "t2", ORDER)).toMatchObject({
      prevId: "t1",
      nextId: "p1",
      index: 1,
    });
    expect(resolveTaskSequence(tasks, "d1", ORDER)).toMatchObject({
      prevId: "p1",
      nextId: null,
      index: 3,
    });
  });

  it("walks a sub-issue's siblings, not the board", () => {
    expect(resolveTaskSequence(tasks, "s2", ORDER)).toEqual({
      prevId: "s1",
      nextId: null,
      index: 1,
      total: 2,
    });
  });

  it("is empty for an unknown task or an empty cache", () => {
    expect(resolveTaskSequence(tasks, "nope", ORDER).index).toBe(-1);
    expect(resolveTaskSequence(undefined, "t1", ORDER).total).toBe(0);
  });

  it("ranks unknown statuses after the known columns", () => {
    const seq = resolveTaskSequence(
      [
        { id: "x", status: "weird", position: 0 },
        { id: "a", status: "done", position: 9 },
      ],
      "a",
      ORDER,
    );
    expect(seq.nextId).toBe("x");
  });

  describe("with a published visible order", () => {
    it("walks the visible order when the current task is in it", () => {
      // e.g. the board sorted by priority, Done hidden: p1, t2, t1.
      expect(
        resolveTaskSequence(tasks, "t2", ORDER, ["p1", "t2", "t1"]),
      ).toEqual({ prevId: "p1", nextId: "t1", index: 1, total: 3 });
    });

    it("falls back to board order when the task isn't visible", () => {
      // d1 was filtered out (Done hidden) — board order still navigates.
      expect(
        resolveTaskSequence(tasks, "d1", ORDER, ["p1", "t2", "t1"]),
      ).toMatchObject({ prevId: "p1", nextId: null, index: 3, total: 4 });
    });

    it("skips ids that left the cache and duplicate ids", () => {
      expect(
        resolveTaskSequence(tasks, "t1", ORDER, ["gone", "t2", "t2", "t1", "x"]),
      ).toEqual({ prevId: "t2", nextId: null, index: 1, total: 2 });
    });

    it("ignores an empty order and keeps sub-issue sibling walking", () => {
      expect(resolveTaskSequence(tasks, "t1", ORDER, [])).toMatchObject({
        nextId: "t2",
      });
      expect(
        resolveTaskSequence(tasks, "s2", ORDER, ["t1", "t2"]),
      ).toMatchObject({ prevId: "s1", nextId: null });
    });
  });
});
