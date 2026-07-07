import "server-only";
/**
 * Recurrence signals + chatter evidence — the two inputs that let the
 * intelligence brief say "3rd week running" and quote the line that proves
 * it. Both respect the house cost model:
 *
 *   - Recurrence is pure code over data we already store (workflow_events,
 *     meeting_summaries): tasks reopened repeatedly, tasks that keep
 *     re-entering blocked, near-identical meeting items resurfacing across
 *     meetings. No model anywhere.
 *   - Chatter is gathered ONLY for projects the deterministic pace flags
 *     already marked behind/at_risk — verbatim lines from the project's
 *     team channels and meeting extractions, handed to the (single,
 *     existing) brief generation as quotable evidence. The model may cite
 *     a line; it may not write one (the brief generator validates quotes
 *     verbatim against this list).
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { InsightScope } from "./scope";
import type { TrendSignal } from "./trends";
import type { PortfolioRow } from "./metrics";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/* ── Recurrence (deterministic) ───────────────────────────────────────────── */

export type RecurrenceResult = {
  signals: TrendSignal[];
  /** Stable digest — folded into the brief fingerprint so a new recurrence
   *  triggers regeneration even when the headline numbers haven't moved. */
  hash: string;
};

export async function computeRecurrenceSignals(
  propertyId: string,
  scope: InsightScope,
): Promise<RecurrenceResult> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 8 * WEEK_MS).toISOString();

  const [eventsRes, tasksRes, meetingsRes] = await Promise.all([
    supabase
      .from("workflow_events")
      .select(
        "entity_id, received_at, to:payload->>to, from:payload->>from" as string,
      )
      .eq("property_id", propertyId)
      .eq("event_type", "task.status_changed")
      .gte("received_at", since)
      .order("received_at", { ascending: true })
      .limit(10000),
    supabase
      .from("tasks")
      .select("id, title, status, space_id, project_id, assignee_id")
      .eq("property_id", propertyId),
    // Meetings are property-level; meeting recurrence only joins the
    // property lens so a team lens never narrates another team's standup.
    scope.kind === "property"
      ? supabase
          .from("meetings")
          .select("id, title, started_at, meeting_summaries(action_items, decisions)")
          .eq("property_id", propertyId)
          .gte("started_at", new Date(Date.now() - 4 * WEEK_MS).toISOString())
      : Promise.resolve({ data: null }),
  ]);

  type Ev = {
    entity_id: string | null;
    received_at: string;
    to: string | null;
    from: string | null;
  };
  const events = (eventsRes.data ?? []) as unknown as Ev[];
  const tasks = (tasksRes.data ?? []) as {
    id: string;
    title: string;
    status: string;
    space_id: string | null;
    project_id: string | null;
    assignee_id: string | null;
  }[];
  const inScope = (t: (typeof tasks)[number]) =>
    scope.kind === "property"
      ? true
      : scope.kind === "project"
        ? t.project_id === scope.id
        : scope.kind === "space"
          ? t.space_id === scope.id
          : t.assignee_id === scope.id;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const reopens = new Map<string, number>();
  const blockedAgain = new Map<string, number>();
  for (const e of events) {
    if (!e.entity_id) continue;
    const t = taskById.get(e.entity_id);
    if (!t || !inScope(t)) continue;
    if (e.from === "done" && e.to !== "done")
      reopens.set(e.entity_id, (reopens.get(e.entity_id) ?? 0) + 1);
    if (e.to === "blocked")
      blockedAgain.set(e.entity_id, (blockedAgain.get(e.entity_id) ?? 0) + 1);
  }

  const signals: TrendSignal[] = [];
  const hashParts: string[] = [];

  const reopened = [...reopens.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [taskId, n] of reopened) {
    const t = taskById.get(taskId)!;
    signals.push({
      signal: "task_reopened_repeatedly",
      evidence: `"${t.title}" has been reopened ${n} times in 8 weeks (currently ${t.status.replace("_", " ")})`,
    });
    hashParts.push(`r:${taskId}:${n}`);
  }

  const reblocked = [...blockedAgain.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [taskId, n] of reblocked) {
    const t = taskById.get(taskId)!;
    signals.push({
      signal: "task_blocked_repeatedly",
      evidence: `"${t.title}" has entered blocked ${n} separate times in 8 weeks`,
    });
    hashParts.push(`b:${taskId}:${n}`);
  }

  // Near-identical meeting items resurfacing across distinct meetings —
  // token-overlap (Jaccard) grouping, no model.
  if (meetingsRes.data) {
    type MeetingRow = {
      id: string;
      title: string;
      started_at: string;
      meeting_summaries:
        | {
            action_items: { text: string; owner: string | null }[] | null;
            decisions: string[] | null;
          }[]
        | null;
    };
    const items: { text: string; meetingId: string; at: number }[] = [];
    for (const m of (meetingsRes.data ?? []) as unknown as MeetingRow[]) {
      const at = new Date(m.started_at).getTime();
      for (const s of m.meeting_summaries ?? []) {
        for (const it of s.action_items ?? [])
          items.push({ text: it.text, meetingId: m.id, at });
      }
    }
    const groups = groupBySimilarity(items.slice(0, 200));
    for (const g of groups) {
      const meetingIds = new Set(g.map((i) => i.meetingId));
      if (meetingIds.size < 2) continue;
      const spanDays = (Math.max(...g.map((i) => i.at)) - Math.min(...g.map((i) => i.at))) / DAY_MS;
      if (spanDays < 5) continue;
      const weeks = Math.max(1, Math.round(spanDays / 7));
      signals.push({
        signal: "meeting_item_recurring",
        evidence: `"${g[0].text}" has come up in ${meetingIds.size} meetings across ${weeks} week(s) and still has no owner closing it`,
      });
      hashParts.push(`m:${normalizeTokens(g[0].text).join(".")}:${meetingIds.size}`);
      if (signals.length >= 8) break;
    }
  }

  return { signals, hash: djb2(hashParts.sort().join("|")) };
}

function normalizeTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    ),
  ].sort();
}

function groupBySimilarity(
  items: { text: string; meetingId: string; at: number }[],
): { text: string; meetingId: string; at: number }[][] {
  const tokenized = items.map((i) => ({ i, tokens: new Set(normalizeTokens(i.text)) }));
  const used = new Set<number>();
  const groups: (typeof items)[] = [];
  for (let a = 0; a < tokenized.length; a++) {
    if (used.has(a) || tokenized[a].tokens.size === 0) continue;
    const group = [tokenized[a].i];
    used.add(a);
    for (let b = a + 1; b < tokenized.length; b++) {
      if (used.has(b)) continue;
      const inter = [...tokenized[a].tokens].filter((t) => tokenized[b].tokens.has(t)).length;
      const union = new Set([...tokenized[a].tokens, ...tokenized[b].tokens]).size;
      if (union > 0 && inter / union >= 0.6) {
        group.push(tokenized[b].i);
        used.add(b);
      }
    }
    if (group.length >= 2) groups.push(group);
  }
  return groups;
}

function djb2(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/* ── Chatter evidence (gated on deterministic risk flags) ─────────────────── */

export type ChatterLine = {
  /** Verbatim text the brief may quote (truncated for prompt budget). */
  quote: string;
  /** Where it came from: "#channel-name" or "meeting: <title>". */
  source: string;
  projectName: string;
};

/**
 * Verbatim lines from the flagged projects' team channels (last 7 days) and
 * meeting extractions mentioning the project. Hard caps everywhere; fails
 * soft to [] so a Stream hiccup never blocks a brief.
 */
export async function gatherProjectChatter(
  propertyId: string,
  flagged: PortfolioRow[],
): Promise<ChatterLine[]> {
  if (flagged.length === 0) return [];
  const supabase = createServiceClient();
  const projects = flagged.slice(0, 2);
  const lines: ChatterLine[] = [];

  try {
    const { data: links } = await supabase
      .from("project_spaces")
      .select("project_id, space_id")
      .in("project_id", projects.map((p) => p.projectId));
    const spaceIds = [...new Set((links ?? []).map((l) => l.space_id as string))];

    if (spaceIds.length > 0) {
      const { data: channels } = await supabase
        .from("chat_channels")
        .select("name, stream_channel_id, stream_channel_type, space_id")
        .eq("property_id", propertyId)
        .in("space_id", spaceIds)
        .is("archived_at", null)
        .limit(4);

      const projectNameBySpace = new Map<string, string>();
      for (const l of links ?? []) {
        const p = projects.find((x) => x.projectId === l.project_id);
        if (p) projectNameBySpace.set(l.space_id as string, p.name);
      }

      const { getStreamServer } = await import("@/lib/stream/server");
      const stream = getStreamServer();
      const cutoff = Date.now() - 7 * DAY_MS;
      for (const ch of channels ?? []) {
        try {
          const state = await stream
            .channel(ch.stream_channel_type ?? "team", ch.stream_channel_id)
            .query({ messages: { limit: 30 } });
          for (const m of state.messages ?? []) {
            if (!m.text || m.text.length < 12) continue;
            if (m.user?.id?.startsWith("bot-") || m.user?.id === "hotelclaw") continue;
            if (m.created_at && new Date(m.created_at).getTime() < cutoff) continue;
            lines.push({
              quote: `${m.user?.name ?? "Someone"}: ${m.text.slice(0, 200)}`,
              source: `#${ch.name}`,
              projectName:
                projectNameBySpace.get(ch.space_id as string) ?? projects[0].name,
            });
          }
        } catch (err) {
          console.error("[chatter] channel query failed", ch.name, err);
        }
      }
    }

    // Meeting lines that mention a flagged project by name.
    const { data: meetings } = await supabase
      .from("meetings")
      .select("title, started_at, meeting_summaries(action_items, decisions)")
      .eq("property_id", propertyId)
      .gte("started_at", new Date(Date.now() - 14 * DAY_MS).toISOString());
    for (const m of (meetings ?? []) as unknown as {
      title: string;
      meeting_summaries:
        | {
            action_items: { text: string }[] | null;
            decisions: string[] | null;
          }[]
        | null;
    }[]) {
      for (const s of m.meeting_summaries ?? []) {
        const texts = [
          ...(s.decisions ?? []),
          ...(s.action_items ?? []).map((a) => a.text),
        ];
        for (const text of texts) {
          const hit = projects.find((p) =>
            text.toLowerCase().includes(p.name.toLowerCase()),
          );
          if (hit) {
            lines.push({
              quote: text.slice(0, 200),
              source: `meeting: ${m.title}`,
              projectName: hit.name,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[chatter] gather failed", err);
  }

  return lines.slice(0, 60);
}
