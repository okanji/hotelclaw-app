import "server-only";
/**
 * Shift-brief gather — everything the personal "since your last shift"
 * brief shows, collected deterministically. The UI renders this payload
 * directly (task links and one-tap actions are correct by construction);
 * the model only writes a short orientation paragraph on top and never
 * touches a number. `since` is the user's `shift_briefs.last_seen_at`
 * cursor.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { computeMyWeek, type AttentionItem } from "./metrics";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cursor floor — a user away for a month catches up on a week, not 30d. */
const MAX_WINDOW_MS = 7 * DAY_MS;

export type ShiftBriefDecision = {
  meetingId: string;
  meetingTitle: string;
  decision: string;
};

export type ShiftBriefActionItem = {
  meetingId: string;
  meetingTitle: string;
  text: string;
};

export type ShiftBriefSpaceChange = {
  spaceId: string;
  spaceName: string;
  created: number;
  completed: number;
  blocked: number;
  /** Up to 8 named highlights, newest first: "<title> — completed". */
  highlights: { taskId: string; title: string; what: string }[];
};

export type ShiftBriefPayload = {
  since: string;
  attention: AttentionItem[];
  openTotal: number;
  overdueTotal: number;
  decisions: ShiftBriefDecision[];
  /** Managers only — unowned meeting commitments offered as one-tap tasks. */
  unownedActionItems: ShiftBriefActionItem[];
  spaceChanges: ShiftBriefSpaceChange[];
};

export function isEmptyShiftBrief(p: ShiftBriefPayload): boolean {
  return (
    p.attention.length === 0 &&
    p.decisions.length === 0 &&
    p.unownedActionItems.length === 0 &&
    p.spaceChanges.every(
      (s) => s.created === 0 && s.completed === 0 && s.blocked === 0,
    )
  );
}

/** djb2 over the stable facts — same change-detection scheme as
 *  `metricsFingerprint`. The model reruns only when this moves. */
export function shiftBriefFingerprint(p: ShiftBriefPayload): string {
  const key = JSON.stringify({
    a: p.attention.map((a) => [a.taskId, a.kind, a.ageDays]),
    o: [p.openTotal, p.overdueTotal],
    d: p.decisions.map((d) => [d.meetingId, d.decision]),
    u: p.unownedActionItems.map((u) => [u.meetingId, u.text]),
    s: p.spaceChanges.map((s) => [s.spaceId, s.created, s.completed, s.blocked]),
  });
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export async function gatherShiftBrief(
  propertyId: string,
  userId: string,
  role: "owner" | "manager" | "staff",
  since: string,
): Promise<ShiftBriefPayload> {
  const supabase = createServiceClient();
  const sinceClamped = new Date(
    Math.max(new Date(since).getTime(), Date.now() - MAX_WINDOW_MS),
  ).toISOString();

  const [{ attention, myWeek }, memberRes, meetingsRes] = await Promise.all([
    computeMyWeek(propertyId, userId),
    supabase.from("space_members").select("space_id").eq("user_id", userId),
    supabase
      .from("meetings")
      .select(
        "id, title, started_at, meeting_summaries(action_items, decisions, created_at)",
      )
      .eq("property_id", propertyId)
      .gte("started_at", sinceClamped)
      .order("started_at", { ascending: false })
      .limit(25),
  ]);

  // ── Decisions + unowned commitments from meetings since the cursor ───────
  type SummaryRow = {
    action_items: { text: string; owner: string | null }[] | null;
    decisions: string[] | null;
    created_at: string;
  };
  const decisions: ShiftBriefDecision[] = [];
  const unownedActionItems: ShiftBriefActionItem[] = [];
  for (const m of (meetingsRes.data ?? []) as unknown as {
    id: string;
    title: string;
    meeting_summaries: SummaryRow[] | null;
  }[]) {
    for (const s of m.meeting_summaries ?? []) {
      for (const d of s.decisions ?? []) {
        decisions.push({ meetingId: m.id, meetingTitle: m.title, decision: d });
      }
      for (const item of s.action_items ?? []) {
        if (!item.owner) {
          unownedActionItems.push({
            meetingId: m.id,
            meetingTitle: m.title,
            text: item.text,
          });
        }
      }
    }
  }

  // ── Notable changes in my spaces since the cursor ────────────────────────
  const spaceIds = (memberRes.data ?? []).map((r) => r.space_id as string);
  const spaceChanges: ShiftBriefSpaceChange[] = [];
  if (spaceIds.length > 0) {
    const [eventsRes, spacesRes] = await Promise.all([
      supabase
        .from("workflow_events")
        // Same widened JSON-path alias trick as metrics.ts fetchRaw.
        .select(
          "event_type, entity_id, received_at, to:payload->>to, event_space:payload->new->>space_id, title:payload->new->>title" as string,
        )
        .eq("property_id", propertyId)
        .in("event_type", ["task.created", "task.status_changed"])
        .gte("received_at", sinceClamped)
        .order("received_at", { ascending: false })
        .limit(2000),
      supabase.from("spaces").select("id, name").in("id", spaceIds),
    ]);
    type Ev = {
      event_type: string;
      entity_id: string | null;
      to: string | null;
      event_space: string | null;
      title: string | null;
    };
    const nameById = new Map(
      (spacesRes.data ?? []).map((s) => [s.id as string, s.name as string]),
    );
    const bySpace = new Map<string, ShiftBriefSpaceChange>();
    for (const e of (eventsRes.data ?? []) as unknown as Ev[]) {
      if (!e.event_space || !nameById.has(e.event_space)) continue;
      let row = bySpace.get(e.event_space);
      if (!row) {
        row = {
          spaceId: e.event_space,
          spaceName: nameById.get(e.event_space)!,
          created: 0,
          completed: 0,
          blocked: 0,
          highlights: [],
        };
        bySpace.set(e.event_space, row);
      }
      let what: string | null = null;
      if (e.event_type === "task.created") {
        row.created += 1;
        what = "created";
      } else if (e.to === "done") {
        row.completed += 1;
        what = "completed";
      } else if (e.to === "blocked") {
        row.blocked += 1;
        what = "blocked";
      }
      if (what && e.entity_id && row.highlights.length < 8) {
        row.highlights.push({
          taskId: e.entity_id,
          title: e.title ?? "Untitled task",
          what,
        });
      }
    }
    spaceChanges.push(...bySpace.values());
    spaceChanges.sort(
      (a, b) =>
        b.created + b.completed + b.blocked - (a.created + a.completed + a.blocked),
    );
  }

  return {
    since: sinceClamped,
    attention,
    openTotal: myWeek.openTotal,
    overdueTotal: myWeek.overdueTotal,
    decisions: decisions.slice(0, 10),
    unownedActionItems: role === "staff" ? [] : unownedActionItems.slice(0, 8),
    spaceChanges: spaceChanges.slice(0, 4),
  };
}
