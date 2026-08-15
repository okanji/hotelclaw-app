import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Guards the fix for a bug that shipped: a workflow posted
 * "*Assignee:* 33831554-d1a7-4f62-85a5-85952cbc11e4" into a chat channel,
 * because trigger payloads carry `assignee_id` (a uuid from the Postgres
 * trigger) and nothing ever resolved it to a name.
 */

const selectMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => selectMock(ids),
      }),
    }),
  }),
}));

const { hydrateTriggerPayload } = await import("../hydrate-payload");

const MARIA = "33831554-d1a7-4f62-85a5-85952cbc11e4";
const SAM = "11112222-3333-4444-5555-666677778888";

beforeEach(() => {
  selectMock.mockReset();
  selectMock.mockResolvedValue({
    data: [
      { id: MARIA, full_name: "Maria Santos" },
      { id: SAM, full_name: "Sam Okoro" },
    ],
    error: null,
  });
});

describe("hydrateTriggerPayload", () => {
  it("adds a name beside an assignee id inside `new`", async () => {
    const out = await hydrateTriggerPayload({
      new: { id: "t1", title: "Fix fridge", assignee_id: MARIA },
    });
    const rec = out.new as Record<string, unknown>;
    expect(rec.assignee_name).toBe("Maria Santos");
    // The id survives — assign steps still need it.
    expect(rec.assignee_id).toBe(MARIA);
  });

  it("hydrates old and new, and top-level keys", async () => {
    const out = await hydrateTriggerPayload({
      created_by: SAM,
      new: { assignee_id: MARIA },
      old: { assignee_id: SAM },
    });
    expect(out.created_by_name).toBe("Sam Okoro");
    expect((out.new as Record<string, unknown>).assignee_name).toBe("Maria Santos");
    expect((out.old as Record<string, unknown>).assignee_name).toBe("Sam Okoro");
  });

  it("does not query when there are no people ids", async () => {
    const payload = { new: { title: "no people here" } };
    const out = await hydrateTriggerPayload(payload);
    expect(out).toBe(payload);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("ignores non-uuid values in an id field", async () => {
    const out = await hydrateTriggerPayload({ new: { assignee_id: "unassigned" } });
    expect((out.new as Record<string, unknown>).assignee_name).toBeUndefined();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("never overwrites a name the emitter already supplied", async () => {
    const out = await hydrateTriggerPayload({
      new: { assignee_id: MARIA, assignee_name: "Maria (front desk)" },
    });
    expect((out.new as Record<string, unknown>).assignee_name).toBe(
      "Maria (front desk)",
    );
  });

  it("leaves the payload untouched when the lookup fails", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const payload = { new: { assignee_id: MARIA } };
    const out = await hydrateTriggerPayload(payload);
    expect(out).toBe(payload);
  });

  it("leaves the payload untouched when the profile has no name", async () => {
    selectMock.mockResolvedValue({
      data: [{ id: MARIA, full_name: null }],
      error: null,
    });
    const out = await hydrateTriggerPayload({ new: { assignee_id: MARIA } });
    expect((out.new as Record<string, unknown>).assignee_name).toBeUndefined();
  });
});
