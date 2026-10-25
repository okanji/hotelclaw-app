import { describe, expect, it } from "vitest";
import { formatTaskKey, taskKey, taskShortId } from "../task-key";

describe("task keys", () => {
  it("formats <prefix>-<number>", () => {
    expect(formatTaskKey("GHV", 142)).toBe("GHV-142");
    expect(formatTaskKey("HC", 0)).toBe("HC-0");
  });

  it("returns null when either half is missing", () => {
    expect(formatTaskKey(null, 3)).toBeNull();
    expect(formatTaskKey("HC", null)).toBeNull();
    expect(formatTaskKey("", 3)).toBeNull();
  });

  it("prefers the real key, falls back to the UUID glyph", () => {
    const id = "ab12cd34-0000-0000-0000-000000000000";
    expect(taskKey({ id, key: "SEA-9" })).toBe("SEA-9");
    expect(taskKey({ id, key: null })).toBe("T-AB12");
    expect(taskKey({ id })).toBe(taskShortId(id));
  });
});
