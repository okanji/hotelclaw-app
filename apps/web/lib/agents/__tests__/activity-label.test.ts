/**
 * The channel bot's progress labels — the "Searching documents for …" feed the
 * chat shows while an eve turn runs (`AiThinkingIndicator`) and keeps as the
 * steps disclosure under the reply.
 *
 * Imports the RUNTIME's own function rather than a copy: a label that stops
 * naming its subject is a transparency regression, and the point of these
 * assertions is that "Looking through documents…" can never quietly come back
 * when the tool call actually knew which document it was reading.
 *
 * Pure-argument paths only. The id→title lookups (read_document,
 * update_task, …) hit Postgres and are exercised by the live bot harness;
 * here they're asserted to DEGRADE cleanly, which is the property that
 * matters — a missing title must never surface a uuid or an empty label.
 */
import { describe, expect, it } from "vitest";
import { activityLabel } from "../../../../agent/agent/lib/channel-delivery";

const PROPERTY = "00000000-0000-0000-0000-0000000000ff";

describe("activityLabel", () => {
  it("names the skill being loaded", async () => {
    expect(
      await activityLabel(
        [{ toolName: "load_skill", input: { skill: "knowledge-lookup" } }],
        PROPERTY,
      ),
    ).toBe("Loading the knowledge-lookup skill…");
  });

  it("names what a search is searching for", async () => {
    expect(
      await activityLabel(
        [{ toolName: "search_documents", input: { query: "freezer SOP", limit: 5 } }],
        PROPERTY,
      ),
    ).toBe("Searching documents for “freezer SOP”…");
    expect(
      await activityLabel(
        [{ toolName: "brain_search", input: { query: "checkout policy" } }],
        PROPERTY,
      ),
    ).toBe("Searching the knowledge brain for “checkout policy”…");
    expect(
      await activityLabel(
        [{ toolName: "search_chat_messages", input: { query: "boiler" } }],
        PROPERTY,
      ),
    ).toBe("Searching the channel history for “boiler”…");
  });

  it("names the subject of a write", async () => {
    expect(
      await activityLabel(
        [{ toolName: "create_document", input: { title: "Freezer SOP", content_html: "…" } }],
        PROPERTY,
      ),
    ).toBe("Writing a new document, “Freezer SOP”…");
    expect(
      await activityLabel(
        [{ toolName: "create_task", input: { title: "Fix the ice machine" } }],
        PROPERTY,
      ),
    ).toBe("Creating the task “Fix the ice machine”…");
  });

  it("falls back to the plain verb when the call carries no subject", async () => {
    expect(
      await activityLabel([{ toolName: "list_documents", input: { limit: 20 } }], PROPERTY),
    ).toBe("Looking through documents…");
    expect(
      await activityLabel(
        [{ toolName: "list_documents", input: { title_contains: "SOP" } }],
        PROPERTY,
      ),
    ).toBe("Looking for documents matching “SOP”…");
  });

  it("reads the subject of a batch from its first action", async () => {
    expect(
      await activityLabel(
        [
          { toolName: "brain_search", input: { query: "late checkout" } },
          { toolName: "search_tasks", input: { query: "late checkout" } },
        ],
        PROPERTY,
      ),
    ).toBe("Searching the knowledge brain for “late checkout” +1 more…");
  });

  it("degrades readably for an unmapped tool", async () => {
    expect(
      await activityLabel([{ toolName: "some_new_tool", input: {} }], PROPERTY),
    ).toBe("Some new tool…");
  });

  it("clips a long subject to one line", async () => {
    const label = await activityLabel(
      [{ toolName: "brain_think", input: { question: "why ".repeat(60) } }],
      PROPERTY,
    );
    expect(label!.length).toBeLessThan(100);
    expect(label).toContain("…");
  });

  it("returns null when there is nothing to report", async () => {
    expect(await activityLabel([], PROPERTY)).toBeNull();
    expect(await activityLabel([{ toolName: "" }], PROPERTY)).toBeNull();
  });
});
