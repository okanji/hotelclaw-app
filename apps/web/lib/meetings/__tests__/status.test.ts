import { describe, expect, it } from "vitest";
import {
  groupMeetings,
  matchesMeetingQuery,
  meetingState,
  type MeetingStatusInput,
} from "../status";

const NOW = new Date("2026-10-25T12:00:00Z").getTime();
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

function m(over: Partial<MeetingStatusInput> = {}): MeetingStatusInput {
  return {
    started_at: iso(-30),
    ended_at: null,
    scheduled_start: null,
    scheduled_end: null,
    stream_call_type: "default",
    recurrence: null,
    created_at: iso(-30),
    has_summary: false,
    transcript: null,
    ...over,
  };
}

describe("meetingState", () => {
  it("walk-up call without ended_at is live", () => {
    expect(meetingState(m(), NOW)).toMatchObject({ phase: "live", kind: "call" });
  });

  it("abandoned walk-up call (never closed) is past, not live forever", () => {
    const s = meetingState(m({ started_at: iso(-60 * 24 * 150) }), NOW);
    expect(s).toMatchObject({ phase: "past", outcome: "no_transcript", endAt: null });
  });

  it("recently ended call with no transcript is processing", () => {
    expect(meetingState(m({ ended_at: iso(-5) }), NOW)).toMatchObject({
      phase: "past",
      outcome: "processing",
    });
  });

  it("five-month-old ended call with no transcript is NOT processing", () => {
    const s = meetingState(
      m({ started_at: iso(-60 * 24 * 156), ended_at: iso(-60 * 24 * 156 + 20) }),
      NOW,
    );
    expect(s).toMatchObject({ phase: "past", outcome: "no_transcript" });
  });

  it("transcript without summary: summarizing, then failed", () => {
    expect(
      meetingState(
        m({ ended_at: iso(-10), transcript: { status: "fetched", created_at: iso(-5) } }),
        NOW,
      ),
    ).toMatchObject({ outcome: "summarizing" });
    expect(
      meetingState(
        m({ ended_at: iso(-300), transcript: { status: "fetched", created_at: iso(-290) } }),
        NOW,
      ),
    ).toMatchObject({ outcome: "summary_failed" });
  });

  it("summary wins over everything", () => {
    expect(
      meetingState(m({ ended_at: iso(-300), has_summary: true }), NOW),
    ).toMatchObject({ outcome: "summary_ready" });
  });

  it("scheduled meeting in the future is upcoming even though started_at defaulted to now()", () => {
    const s = meetingState(
      m({ started_at: iso(-60), scheduled_start: iso(60), scheduled_end: iso(90) }),
      NOW,
    );
    expect(s).toEqual({ phase: "upcoming", startAt: iso(60), endAt: iso(90) });
  });

  it("scheduled meeting inside its slot is live (scheduled)", () => {
    expect(
      meetingState(m({ scheduled_start: iso(-10), scheduled_end: iso(20) }), NOW),
    ).toMatchObject({ phase: "live", kind: "scheduled" });
  });

  it("scheduled meeting past its slot is past; a no-video entry has no call", () => {
    expect(
      meetingState(
        m({
          scheduled_start: iso(-300),
          scheduled_end: iso(-240),
          stream_call_type: "calendar",
        }),
        NOW,
      ),
    ).toMatchObject({ phase: "past", outcome: "no_call", startAt: iso(-300) });
  });

  it("recurring series rolls forward to the next occurrence", () => {
    const s = meetingState(
      m({
        scheduled_start: iso(-60 * 24 * 7 - 60),
        scheduled_end: iso(-60 * 24 * 7 - 30),
        recurrence: { frequency: "daily", interval: 1 },
      }),
      NOW,
    );
    expect(s.phase).toBe("upcoming");
    expect(new Date(s.startAt).getTime()).toBeGreaterThan(NOW);
  });

  it("recurring series stays upcoming after one occurrence was joined and ended", () => {
    const s = meetingState(
      m({
        scheduled_start: iso(-60 * 24 - 60),
        scheduled_end: iso(-60 * 24 - 30),
        ended_at: iso(-60 * 24 - 25),
        recurrence: { frequency: "daily", interval: 1 },
      }),
      NOW,
    );
    expect(s.phase).toBe("upcoming");
  });
});

describe("groupMeetings", () => {
  it("orders upcoming soonest-first and past newest-first", () => {
    const g = groupMeetings(
      [
        { ...m({ scheduled_start: iso(120), scheduled_end: iso(150) }), id: "u2" },
        { ...m({ scheduled_start: iso(60), scheduled_end: iso(90) }), id: "u1" },
        { ...m({ started_at: iso(-600), ended_at: iso(-580) }), id: "p2" },
        { ...m({ started_at: iso(-200), ended_at: iso(-180) }), id: "p1" },
        { ...m(), id: "l1" },
      ],
      NOW,
    );
    expect(g.upcoming.map((x) => x.id)).toEqual(["u1", "u2"]);
    expect(g.past.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(g.live.map((x) => x.id)).toEqual(["l1"]);
  });
});

describe("matchesMeetingQuery", () => {
  const row = {
    title: "Weekly standup",
    channel_name: "reservations",
    speakers: [{ name: "Ana Ruiz" }],
  };
  it("matches title, #channel, and participants, all words required", () => {
    expect(matchesMeetingQuery(row, "")).toBe(true);
    expect(matchesMeetingQuery(row, "standup")).toBe(true);
    expect(matchesMeetingQuery(row, "#reserv")).toBe(true);
    expect(matchesMeetingQuery(row, "ana weekly")).toBe(true);
    expect(matchesMeetingQuery(row, "budget")).toBe(false);
  });
});
