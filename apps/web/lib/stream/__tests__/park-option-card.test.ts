import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateChatUiSpec } from "@hotelclaw/chat-ui";

/**
 * Contract guards for the tappable park-option cards (2026-08-27):
 * `apps/agent/agent/lib/channel-delivery.ts` synthesizes an ai_ui Options
 * spec from a question park's options so the reader taps instead of typing
 * "reply with a number". These tests pin the two things that would break it
 * silently:
 *
 * 1. The synthesized spec SHAPE must stay valid against the shared catalog
 *    (`@hotelclaw/chat-ui`) — a catalog change that invalidates it would
 *    make every park card silently disappear (the runtime skips cards that
 *    fail validation).
 * 2. The runtime source must keep the synthesis + the job-thread routing
 *    flag (`reply_to_self`) that the web sender honors in
 *    `components/chat/slack-attachment.tsx` — source-text drift guards, the
 *    same style as lib/agents/__tests__/agent-runtime-sync.test.ts.
 */

/** Replica of channel-delivery's synthesis for a park's options. */
function buildParkOptionSpec(
  options: Array<{ id: string; label: string; description: string | null }>,
) {
  return {
    root: "options",
    elements: {
      options: {
        type: "Options",
        props: {
          options: options.slice(0, 6).map((o) => ({
            label: o.label.slice(0, 80),
            value: o.label.slice(0, 200),
            ...(o.description
              ? { description: o.description.slice(0, 120) }
              : {}),
          })),
        },
      },
    },
  };
}

const agentSource = () =>
  readFileSync(
    join(
      __dirname,
      "../../../../agent/agent/lib/channel-delivery.ts",
    ),
    "utf8",
  );

describe("park option cards", () => {
  it("synthesized spec validates against the shared catalog", () => {
    const spec = buildParkOptionSpec([
      { id: "opt_a", label: "Approve", description: "Run the action" },
      { id: "opt_b", label: "Deny", description: null },
    ]);
    const validated = validateChatUiSpec(spec);
    expect(validated.ok).toBe(true);
  });

  it("oversized park options are clamped into validity, not dropped", () => {
    const spec = buildParkOptionSpec(
      Array.from({ length: 9 }, (_, i) => ({
        id: `opt_${i}`,
        label: `${"Very long option label ".repeat(8)}${i}`,
        description: "d".repeat(400),
      })),
    );
    const validated = validateChatUiSpec(spec);
    expect(validated.ok).toBe(true);
  });

  it("runtime synthesizes the card and flags job parks for self-thread replies", () => {
    const source = agentSource();
    // The synthesis exists and targets the Options component.
    expect(source).toContain('root: "options"');
    expect(source).toContain('type: "Options"');
    // Job parks must carry the routing flag the web sender keys on.
    expect(source).toContain("reply_to_self");
    // And the card is validated before attaching (invalid ⇒ skipped, not sent).
    expect(source.split("validateChatUiSpec").length).toBeGreaterThan(2);
  });

  it("web sender honors reply_to_self by threading under the card's message", () => {
    const source = readFileSync(
      join(__dirname, "../../../components/chat/slack-attachment.tsx"),
      "utf8",
    );
    expect(source).toContain("reply_to_self");
    // The self-reply sender threads under the question message itself.
    expect(source).toMatch(/parent_id:\s*messageId/);
  });
});
