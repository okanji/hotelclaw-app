import { describe, it, expect } from "vitest";
import { buildInputResponses } from "@/lib/stream/channel-bot-eve";

/**
 * Answer routing for a session parked on an eve question.
 *
 * The bug this guards: the channel bot's `ask_question` parks were never
 * answered — the question was thrown away by the runtime handler and the user
 * saw "⚠️ AI reply failed" (prod, 2026-07-28). These cases pin the half that
 * addresses a chat reply back to the right parked request.
 */
const QUESTION = {
  requestId: "req_1",
  display: "text",
  prompt: "What outlets does Solana Cove have?",
  action: { toolName: "ask_question", callId: "c1", input: {} },
};

const SELECT = {
  requestId: "req_2",
  display: "select",
  prompt: "Which template?",
  options: [
    { id: "opt_short", label: "Short" },
    { id: "opt_full", label: "Full write-up" },
  ],
};

describe("buildInputResponses", () => {
  it("addresses a free-text answer to the parked request", () => {
    expect(buildInputResponses({ requests: [QUESTION] }, "  A bar and a spa  ")).toEqual([
      { requestId: "req_1", text: "A bar and a spa" },
    ]);
  });

  it("resolves an option picked by its 1-based number", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "2")).toEqual([
      { requestId: "req_2", optionId: "opt_full" },
    ]);
  });

  it("resolves an option picked by label, case-insensitively", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "full write-up")).toEqual([
      { requestId: "req_2", optionId: "opt_full" },
    ]);
  });

  it("resolves an option picked by its raw id", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "opt_short")).toEqual([
      { requestId: "req_2", optionId: "opt_short" },
    ]);
  });

  it("falls back to free text when the answer matches no option", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "neither, do both")).toEqual([
      { requestId: "req_2", text: "neither, do both" },
    ]);
  });

  // Tool approvals are the fleet Approvals inbox's business — answering them
  // from chat would approve a tool call the user never saw.
  it("ignores tool-approval parks", () => {
    const approval = {
      requestId: "req_3",
      display: "confirmation",
      prompt: "Archive this document?",
      options: [
        { id: "approve", label: "Approve" },
        { id: "deny", label: "Deny" },
      ],
    };
    expect(buildInputResponses({ requests: [approval] }, "approve")).toEqual([]);
  });

  it("answers only the question in a mixed park", () => {
    const approval = { requestId: "req_a", display: "confirmation", prompt: "Delete?" };
    expect(buildInputResponses({ requests: [approval, QUESTION] }, "two bars")).toEqual([
      { requestId: "req_1", text: "two bars" },
    ]);
  });

  // Anything unaddressable yields nothing, and the caller resumes with a
  // plain message — the pre-existing behavior, which does still resume.
  it("yields nothing when there is no park, no requestId, or no prompt", () => {
    expect(buildInputResponses(null, "hello")).toEqual([]);
    expect(buildInputResponses({}, "hello")).toEqual([]);
    expect(buildInputResponses({ requests: [] }, "hello")).toEqual([]);
    expect(
      buildInputResponses({ requests: [{ display: "text", prompt: "Q?" }] }, "hi"),
    ).toEqual([]);
    expect(
      buildInputResponses({ requests: [{ requestId: "r", display: "text" }] }, "hi"),
    ).toEqual([]);
  });

  it("yields nothing for an empty reply", () => {
    expect(buildInputResponses({ requests: [QUESTION] }, "   ")).toEqual([]);
  });
});
