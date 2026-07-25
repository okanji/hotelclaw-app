import { describe, expect, it } from "vitest";
import {
  CLUSTER_TIME_GAP_MS,
  slackGroupStyles,
  TURN_FIELD,
} from "@/lib/chat/message-grouping";

const T0 = new Date("2026-07-25T10:00:00.000Z").getTime();

type Msg = Record<string, unknown>;

function msg(over: Partial<Msg> & { user?: string } = {}): Msg {
  const { user = "u1", ...rest } = over;
  return {
    id: Math.random().toString(36).slice(2),
    text: "hi",
    user: { id: user },
    created_at: new Date(T0).toISOString(),
    attachments: [],
    ...rest,
  };
}

function at(offsetMs: number, over: Partial<Msg> & { user?: string } = {}): Msg {
  return msg({ ...over, created_at: new Date(T0 + offsetMs).toISOString() });
}

/** Roles for a whole list, the way MessageList computes them. */
function roles(list: Msg[]): string[] {
  return list.map((m, i) =>
    slackGroupStyles(m, list[i - 1], list[i + 1], false, CLUSTER_TIME_GAP_MS),
  );
}

describe("slackGroupStyles", () => {
  it("clusters consecutive same-author messages sent close together", () => {
    expect(roles([at(0), at(1_000), at(2_000)])).toEqual([
      "top",
      "middle",
      "bottom",
    ]);
  });

  it("starts a new cluster when the same author re-engages after the gap", () => {
    const late = CLUSTER_TIME_GAP_MS + 1_000;
    expect(roles([at(0), at(late)])).toEqual(["single", "single"]);
  });

  it("breaks the cluster when another author interleaves", () => {
    expect(roles([at(0), at(1_000, { user: "u2" }), at(2_000)])).toEqual([
      "single",
      "single",
      "single",
    ]);
  });

  // The bug this module exists to fix: upstream getGroupStyles forces ANY
  // message with an attachment to `single`, so one agent turn that wrote five
  // documents rendered as five replies with five avatar/name/timestamp rows.
  it("does NOT break the cluster on attachments", () => {
    const card = (offset: number) =>
      at(offset, { text: "", attachments: [{ type: "app_artifact" }] });
    expect(roles([card(0), card(1_000), card(2_000), at(3_000)])).toEqual([
      "top",
      "middle",
      "middle",
      "bottom",
    ]);
  });

  it("does NOT break the cluster on reactions", () => {
    expect(
      roles([at(0), at(1_000, { reaction_groups: { "+1": { count: 1 } } }), at(2_000)]),
    ).toEqual(["top", "middle", "bottom"]);
  });

  // Long-running agent turns: artifact cards can land minutes before the
  // written answer, which the plain time rule would split apart.
  it("keeps one agent turn in one cluster past the time gap", () => {
    const turn = { [TURN_FIELD]: "nonce-a" };
    const veryLate = CLUSTER_TIME_GAP_MS * 5;
    expect(
      roles([
        at(0, { ...turn, text: "", attachments: [{ type: "app_artifact" }] }),
        at(veryLate, { ...turn, text: "Done — wrote the SOP." }),
      ]),
    ).toEqual(["top", "bottom"]);
  });

  it("separates two different turns that land close together", () => {
    expect(
      roles([
        at(0, { [TURN_FIELD]: "nonce-a" }),
        at(1_000, { [TURN_FIELD]: "nonce-b" }),
      ]),
    ).toEqual(["top", "bottom"]);
  });

  it("does not merge turns across a different author", () => {
    const turn = { [TURN_FIELD]: "nonce-a" };
    expect(
      roles([at(0, turn), at(1_000, { user: "u2" }), at(2_000, turn)]),
    ).toEqual(["single", "single", "single"]);
  });

  it("returns single for error messages and breaks the neighbours of a system row", () => {
    expect(slackGroupStyles(msg({ type: "error" }), msg(), msg())).toBe("single");
    // Upstream parity: system/error is only ever tested on the NEIGHBOUR, so
    // the real messages either side are cut loose while the system row itself
    // is left with whatever role its own neighbours imply.
    expect(roles([at(0), at(1_000, { type: "system" }), at(2_000)])).toEqual([
      "single",
      "middle",
      "single",
    ]);
  });

  it("ignores date separators and the channel intro", () => {
    expect(slackGroupStyles({ customType: "message.date", date: new Date() })).toBe("");
    expect(slackGroupStyles({ customType: "channel.intro" })).toBe("");
  });

  it("forces single when grouping by user is disabled", () => {
    expect(slackGroupStyles(msg(), msg(), msg(), true)).toBe("single");
  });

  it("keeps an edited message out of the middle of a cluster", () => {
    // Upstream rule, preserved: the edited indicator needs its own row.
    expect(
      roles([at(0), at(1_000, { message_text_updated_at: new Date(T0).toISOString() }), at(2_000)]),
    ).toEqual(["top", "bottom", "single"]);
  });
});
