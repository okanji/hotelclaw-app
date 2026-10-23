import { describe, expect, it } from "vitest";
import {
  createTranscriptReducer,
  displayUserText,
  pendingInputRequests,
  renderedSpecs,
} from "@hotelclaw/chat-ui/transcript";

/**
 * The eve NDJSON→transcript reducer (shared by web + mobile). Each case is a
 * behaviour a surface relies on; the first three are regressions from the
 * eve 0.83 migration (delta streams, multi-block turns, parked questions).
 */
function run(events: Array<{ type: string; data?: Record<string, unknown> }>) {
  const waits: number[] = [];
  const reducer = createTranscriptReducer({ onWaiting: () => waits.push(1) });
  for (const e of events) reducer.handle({ type: e.type, data: e.data ?? {} });
  return { items: reducer.items, waits };
}

describe("transcript reducer", () => {
  it("accumulates message deltas and takes message.completed as authoritative", () => {
    const { items } = run([
      { type: "message.received", data: { message: "hi" } },
      { type: "message.appended", data: { messageDelta: "Hel" } },
      { type: "message.appended", data: { messageDelta: "lo" } },
      { type: "message.completed", data: { message: "Hello!" } },
      { type: "session.waiting" },
    ]);
    expect(items).toHaveLength(2);
    const a = items[1];
    expect(a.kind).toBe("assistant");
    if (a.kind === "assistant") {
      expect(a.text).toBe("Hello!");
      expect(a.streaming).toBe(false);
    }
  });

  it("keeps every completed block of a multi-part turn in order", () => {
    const { items } = run([
      { type: "message.received", data: { message: "audit" } },
      { type: "message.completed", data: { message: "Checking the tasks." } },
      {
        type: "actions.requested",
        data: { actions: [{ kind: "tool-call", callId: "c1", toolName: "search_tasks", input: { q: "x" } }] },
      },
      { type: "action.result", data: { result: { callId: "c1", output: { count: 3 } } } },
      { type: "message.completed", data: { message: "Three blocked tasks." } },
      { type: "session.waiting" },
    ]);
    const a = items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.blocks).toEqual(["Checking the tasks.", "Three blocked tasks."]);
    expect(a.text).toBe("Checking the tasks.\n\nThree blocked tasks.");
    expect(a.toolCalls[0]).toMatchObject({ callId: "c1", toolName: "search_tasks", done: true, output: { count: 3 } });
  });

  it("supports the legacy cumulative messageSoFar shape", () => {
    const { items } = run([
      { type: "message.received", data: { message: "hi" } },
      { type: "message.appended", data: { messageSoFar: "He" } },
      { type: "message.appended", data: { messageSoFar: "Hey" } },
    ]);
    const a = items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.text).toBe("Hey");
    expect(a.streaming).toBe(true);
  });

  it("records a parked question, signals waiting on turn.waiting(input), and settles it on input.resolved", () => {
    const events = [
      { type: "message.received", data: { message: "book a table" } },
      {
        type: "input.requested",
        data: {
          requests: [
            {
              requestId: "r1",
              kind: "question",
              prompt: "Which service?",
              display: "select",
              allowFreeform: true,
              options: [
                { id: "a", label: "Restaurant" },
                { id: "b", label: "Spa", description: "Treatments" },
              ],
            },
          ],
        },
      },
      { type: "turn.waiting", data: { on: "input" } },
    ];
    const first = run(events);
    expect(first.waits).toHaveLength(1);
    expect(pendingInputRequests(first.items)).toHaveLength(1);
    expect(pendingInputRequests(first.items)[0]).toMatchObject({
      requestId: "r1",
      kind: "question",
      allowFreeform: true,
      options: [{ id: "a", label: "Restaurant", description: null }, { id: "b", label: "Spa", description: "Treatments" }],
    });

    const second = run([
      ...events,
      { type: "input.resolved", data: { resolutions: [{ requestId: "r1", outcome: "answered", response: { optionId: "b" } }] } },
      { type: "message.completed", data: { message: "Spa it is." } },
      { type: "session.waiting" },
    ]);
    expect(pendingInputRequests(second.items)).toHaveLength(0);
    const a = second.items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.requests[0]).toMatchObject({ outcome: "answered", answer: "b" });
  });

  it("classifies a confirmation with an action as a tool approval", () => {
    const { items } = run([
      { type: "message.received", data: { message: "archive it" } },
      {
        type: "input.requested",
        data: {
          requests: [
            {
              requestId: "ap1",
              display: "confirmation",
              prompt: "Archive 'Freezer SOP'?",
              action: { toolName: "archive_document", input: { document_id: "d1" }, callId: "c9" },
              options: [{ id: "approve", label: "Approve" }, { id: "cancel", label: "Cancel" }],
            },
          ],
        },
      },
    ]);
    const a = items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.requests[0].kind).toBe("tool-approval");
    expect(a.requests[0].action).toMatchObject({ toolName: "archive_document", callId: "c9" });
  });

  it("does not treat turn.waiting(on: tasks) as a settle point and tracks tasks", () => {
    const { items, waits } = run([
      { type: "message.received", data: { message: "go" } },
      { type: "task.started", data: { taskId: "t1", name: "bookings", kind: "agent" } },
      { type: "turn.waiting", data: { on: "tasks" } },
      { type: "task.settled", data: { taskId: "t1", status: "completed", output: "ok" } },
    ]);
    expect(waits).toHaveLength(0);
    const a = items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.tasks[0]).toMatchObject({ taskId: "t1", kind: "agent", status: "completed", output: "ok" });
  });

  it("captures reasoning deltas, tool errors and turn failures", () => {
    const { items } = run([
      { type: "message.received", data: { message: "x" } },
      { type: "reasoning.appended", data: { reasoningDelta: "Think" } },
      { type: "reasoning.appended", data: { reasoningDelta: "ing" } },
      { type: "reasoning.completed", data: { reasoning: "Thinking…" } },
      { type: "actions.requested", data: { actions: [{ kind: "tool-call", callId: "c1", toolName: "read_document", input: {} }] } },
      { type: "action.result", data: { result: { callId: "c1", output: "not found", isError: true } } },
      { type: "turn.failed", data: { code: "model_error", message: "boom" } },
    ]);
    const a = items[1];
    if (a.kind !== "assistant") throw new Error("expected assistant");
    expect(a.reasoning).toEqual(["Thinking…"]);
    expect(a.toolCalls[0].error).toBe("not found");
    expect(a.failure).toEqual({ code: "model_error", message: "boom" });
  });

  it("extracts render_ui specs and strips plumbing from user text", () => {
    const spec = { root: "r", elements: {} };
    expect(
      renderedSpecs([
        { callId: "c1", toolName: "render_ui", input: {}, done: true, output: { ai_ui_spec: spec } },
        { callId: "c2", toolName: "render_ui", input: {}, done: false },
        { callId: "c3", toolName: "search_tasks", input: {}, done: true, output: {} },
      ]),
    ).toEqual([{ callId: "c1", spec }]);
    expect(displayUserText("[turn 123e4567-e89b-12d3-a456-426614174000]\n[Now: 2026-10-23T10:00:00.000Z (UTC)]\n\nhello")).toBe("hello");
    expect(displayUserText("[Now: 2026-10-23T10:00:00.000Z (UTC)]\n\nhello")).toBe("hello");
    expect(displayUserText("plain")).toBe("plain");
  });
});
