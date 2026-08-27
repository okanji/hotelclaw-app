import { describe, expect, it } from "vitest";
import { validateChatUiSpec, CHAT_UI_TOOL_DESCRIPTION } from "@hotelclaw/chat-ui";

describe("Options component", () => {
  it("accepts a valid Options spec (bare and inside a Stack)", () => {
    const bare = validateChatUiSpec({
      root: "o",
      elements: {
        o: {
          type: "Options",
          props: {
            prompt: "Want it trimmed, expanded, or as-is?",
            options: [
              { label: "Go ahead as-is" },
              { label: "Trim it", value: "Trim it — project + 4 core tasks only" },
              { label: "Just the project", description: "No tasks yet" },
            ],
          },
        },
      },
    });
    expect(bare.ok).toBe(true);

    const stacked = validateChatUiSpec({
      root: "s",
      elements: {
        s: { type: "Stack", props: {}, children: ["t", "o"] },
        t: {
          type: "DataTable",
          props: { columns: ["Task"], rows: [["Confirm contract"]] },
        },
        o: {
          type: "Options",
          props: { options: [{ label: "Go" }, { label: "Cancel" }] },
        },
      },
    });
    expect(stacked.ok).toBe(true);
  });

  it("rejects bad Options props and children", () => {
    // one option only (min 2)
    expect(
      validateChatUiSpec({
        root: "o",
        elements: {
          o: { type: "Options", props: { options: [{ label: "Only" }] } },
        },
      }).ok,
    ).toBe(false);
    // Options is a leaf — no children
    expect(
      validateChatUiSpec({
        root: "o",
        elements: {
          o: {
            type: "Options",
            props: { options: [{ label: "A" }, { label: "B" }] },
            children: ["x"],
          },
          x: { type: "Stack", props: {} },
        },
      }).ok,
    ).toBe(false);
    // unknown prop keys are stripped, not fatal
    const stripped = validateChatUiSpec({
      root: "o",
      elements: {
        o: {
          type: "Options",
          props: { options: [{ label: "A" }, { label: "B" }], bogus: 1 },
        },
      },
    });
    expect(stripped.ok).toBe(true);
    if (stripped.ok) {
      expect("bogus" in stripped.spec.elements.o.props).toBe(false);
    }
  });

  it("documents Options in the tool description", () => {
    expect(CHAT_UI_TOOL_DESCRIPTION).toContain("Options —");
    expect(CHAT_UI_TOOL_DESCRIPTION).toContain("quick-reply");
  });
});
