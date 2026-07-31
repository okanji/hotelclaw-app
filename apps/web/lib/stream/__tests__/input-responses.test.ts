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
  it("flags a bare decision as fully consuming the message", () => {
    // Then the caller sends ONLY the input response — echoing "2" back as a
    // user message made the model answer "not sure what 2 refers to".
    expect(buildInputResponses({ requests: [APPROVAL] }, "@hotelclaw 2").consumedAnswer).toBe(true);
    expect(buildInputResponses({ requests: [APPROVAL] }, "yes").consumedAnswer).toBe(true);
    // Extra content means the text still carries intent — forward it.
    expect(
      buildInputResponses({ requests: [APPROVAL] }, "no, reword it first").consumedAnswer,
    ).toBe(false);
    expect(buildInputResponses({ requests: [QUESTION] }, "two bars").consumedAnswer).toBe(false);
  });

  it("addresses a free-text answer to the parked request", () => {
    expect(buildInputResponses({ requests: [QUESTION] }, "  A bar and a spa  ").responses).toEqual([
      { requestId: "req_1", text: "A bar and a spa" },
    ]);
  });

  it("resolves an option picked by its 1-based number", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "2").responses).toEqual([
      { requestId: "req_2", optionId: "opt_full" },
    ]);
  });

  it("resolves an option picked by label, case-insensitively", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "full write-up").responses).toEqual([
      { requestId: "req_2", optionId: "opt_full" },
    ]);
  });

  it("resolves an option picked by its raw id", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "opt_short").responses).toEqual([
      { requestId: "req_2", optionId: "opt_short" },
    ]);
  });

  it("falls back to free text when the answer matches no option", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "neither, do both").responses).toEqual([
      { requestId: "req_2", text: "neither, do both" },
    ]);
  });

  // Tool approvals ARE answered from chat: the fleet Approvals inbox reads
  // bot_chat_sessions (pod bots), so a channel-bot approval has no other
  // decision path — the channel is the surface that must resolve it.
  const APPROVAL = {
    requestId: "req_3",
    display: "confirmation",
    prompt: "Archive this document?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "deny", label: "Deny" },
    ],
  };

  it("resolves an approval decided by option label", () => {
    expect(buildInputResponses({ requests: [APPROVAL] }, "Approve").responses).toEqual([
      { requestId: "req_3", optionId: "approve" },
    ]);
  });

  it("resolves a denial", () => {
    expect(buildInputResponses({ requests: [APPROVAL] }, "deny").responses).toEqual([
      { requestId: "req_3", optionId: "deny" },
    ]);
  });

  // The trigger text is the RAW channel message, so an answer typed in a
  // channel arrives mention-prefixed. Matching without stripping it fell
  // through to freeform text and the bot re-asked the same approval (caught
  // live, 2026-07-31).
  it("strips a leading @mention before matching", () => {
    expect(buildInputResponses({ requests: [APPROVAL] }, "@hotelclaw 2").responses).toEqual([
      { requestId: "req_3", optionId: "deny" },
    ]);
    expect(buildInputResponses({ requests: [SELECT] }, "@hotelclaw 1").responses).toEqual([
      { requestId: "req_2", optionId: "opt_short" },
    ]);
  });

  it("accepts natural yes/no on a two-option approval", () => {
    for (const yes of ["yes", "Yes please", "approve", "go ahead", "ok"]) {
      expect(buildInputResponses({ requests: [APPROVAL] }, yes).responses).toEqual([
        { requestId: "req_3", optionId: "approve" },
      ]);
    }
    for (const no of ["no", "nope", "deny", "cancel", "don't"]) {
      expect(buildInputResponses({ requests: [APPROVAL] }, no).responses).toEqual([
        { requestId: "req_3", optionId: "deny" },
      ]);
    }
  });

  // Natural-language matching is approval-only: on a content question,
  // "no" is an answer, not a decision.
  it("does not apply yes/no matching to questions", () => {
    expect(buildInputResponses({ requests: [SELECT] }, "no").responses).toEqual([
      { requestId: "req_2", text: "no" },
    ]);
  });

  it("answers every parked request in a mixed park", () => {
    expect(buildInputResponses({ requests: [APPROVAL, QUESTION] }, "1").responses).toEqual([
      { requestId: "req_3", optionId: "approve" },
      { requestId: "req_1", text: "1" },
    ]);
  });

  // Anything unaddressable yields nothing, and the caller resumes with a
  // plain message — the pre-existing behavior, which does still resume.
  it("yields nothing when there is no park, no requestId, or no prompt", () => {
    expect(buildInputResponses(null, "hello").responses).toEqual([]);
    expect(buildInputResponses({}, "hello").responses).toEqual([]);
    expect(buildInputResponses({ requests: [] }, "hello").responses).toEqual([]);
    expect(
      buildInputResponses({ requests: [{ display: "text", prompt: "Q?" }] }, "hi")
        .responses,
    ).toEqual([]);
    expect(
      buildInputResponses({ requests: [{ requestId: "r", display: "text" }] }, "hi")
        .responses,
    ).toEqual([]);
  });

  it("yields nothing for an empty reply", () => {
    expect(buildInputResponses({ requests: [QUESTION] }, "   ").responses).toEqual([]);
  });
});
