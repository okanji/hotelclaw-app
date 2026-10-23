import { describe, expect, it } from "vitest";
import { feedbackToMemory } from "@/lib/memory/learn";

describe("feedbackToMemory (deterministic distiller)", () => {
  it("ignores ratings without a note — a bare thumb teaches nothing durable", () => {
    expect(feedbackToMemory({ rating: -1, note: null, excerpt: "x", surface: "assistant" })).toBeNull();
    expect(feedbackToMemory({ rating: 1, note: "   ", excerpt: "x", surface: "assistant" })).toBeNull();
  });

  it("turns a 👎 note into a correction memory that quotes what it was about", () => {
    const out = feedbackToMemory({
      rating: -1,
      note: "Give me totals first, then the breakdown.",
      excerpt: "Here is the weekly report broken down by team…",
      surface: "insights",
    });
    expect(out).toBe(
      'Correction (insights): Give me totals first, then the breakdown. — said about a reply that began "Here is the weekly report broken down by team……"',
    );
  });

  it("labels praise distinctly and copes without an excerpt", () => {
    expect(
      feedbackToMemory({ rating: 1, note: "Exactly this format.", excerpt: null, surface: "task" }),
    ).toBe("Liked (task): Exactly this format.");
  });
});
