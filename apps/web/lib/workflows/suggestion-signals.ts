import "server-only";
/**
 * The deterministic evidence behind automation suggestions.
 *
 * "What could I automate on this page?" is only a useful question if the
 * answer knows what's actually ON the page. This module gathers, per feature,
 * a compact set of **signals** describing the property's real situation —
 * 23 overdue tasks, 8 docs untouched in 90 days, a service with a 31%
 * cancellation rate — which the suggester then reasons over.
 *
 * House doctrine (same as the insights brief, `lib/ai/bots/insights-bot.ts`):
 * **no model in the number path.** Every figure here comes from Postgres or
 * the existing deterministic metrics layer. The model reads these signals and
 * proposes automations; it never computes a statistic, and it cites the signal
 * ids it used in `basis` so the UI can show its work.
 *
 * Each signal carries a stable `id` (`s1`, `s2`, …) for exactly that citation
 * handshake — the route drops any id the model invents.
 *
 * Every gather is bounded (LIMITs, short windows) and fail-soft: a broken or
 * empty surface yields fewer signals, never an error. Suggestions still work
 * with zero signals — they're just generic instead of pointed.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { computeInsightsMetrics } from "@/lib/insights/metrics";
import { computeTrendSignals } from "@/lib/insights/trends";
import { detectAnomalies } from "@/lib/insights/anomalies";
import type { AutomationFeature } from "@/lib/workflows/features";

export type SuggestionSignal = {
  /** Stable citation handle (`s1`, `s2`, …). Assigned at the end. */
  id: string;
  /** Short machine-ish name — what kind of thing this is. */
  signal: string;
  /** The human-readable line shown to the user as provenance. */
  evidence: string;
};

/** Signals before ids are stamped on. */
type RawSignal = Omit<SuggestionSignal, "id">;

const DAY_MS = 86_400_000;
const MAX_SIGNALS = 18;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function daysAhead(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString();
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Most-frequent values with counts, biggest first. */
function topCounts<T>(rows: T[], key: (r: T) => string | null | undefined, limit = 4) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// ─── Per-feature gathers ────────────────────────────────────────────────────

/**
 * Tasks reuses the REAL metrics layer — the same `computeInsightsMetrics` the
 * dashboards chart and the insights brief reasons over — rather than a second,
 * quietly-diverging definition of "overdue".
 */
async function tasksSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const metrics = await computeInsightsMetrics(propertyId);
  const { snapshot, attention, cycleTime, portfolio } = metrics;
  const open = snapshot.openTotal;
  const countOf = (status: string) =>
    snapshot.byStatus.find((s) => s.status === status)?.count ?? 0;

  if (open > 0) {
    out.push({
      signal: "open_work",
      evidence: `${open} open tasks (${countOf("todo")} to do, ${countOf("in_progress")} in progress, ${countOf("blocked")} blocked)`,
    });
  }
  if (snapshot.overdueTotal > 0) {
    out.push({
      signal: "overdue_total",
      evidence: `${snapshot.overdueTotal} open tasks are past their due date (${pct(snapshot.overdueTotal, open)}% of open work)`,
    });
  }
  const blocked = countOf("blocked");
  if (blocked > 0) {
    out.push({
      signal: "blocked_share",
      evidence: `${blocked} tasks are blocked — ${pct(blocked, open)}% of open work`,
    });
  }

  // Attention items are already classified (overdue / blocked / likely_to_slip
  // / unassigned_urgent) — group them so the model sees the shape, not 40 rows.
  // `blocked` and `overdue` are skipped: the snapshot above already states both
  // with a percentage, and two lines saying the same thing read as padding in
  // the provenance list the user sees.
  for (const [kind, count] of topCounts(attention, (a) => a.kind, 5)) {
    if (kind === "blocked" || kind === "overdue") continue;
    out.push({
      signal: `attention_${kind}`,
      evidence: `${count} task${count === 1 ? "" : "s"} flagged "${kind.replace(/_/g, " ")}"`,
    });
  }

  if (cycleTime?.medianDays != null) {
    out.push({
      signal: "cycle_time",
      evidence: `Median time from creation to done is ${cycleTime.medianDays} days (over ${cycleTime.sample} tasks)`,
    });
  }
  const behind = portfolio.filter((p) => p.pace === "behind" || p.pace === "at_risk");
  if (behind.length > 0) {
    out.push({
      signal: "projects_behind",
      evidence: `${behind.length} project${behind.length === 1 ? " is" : "s are"} behind or at risk: ${behind
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ")}`,
    });
  }

  // Trends + anomalies are the "what's CHANGING" half — an automation that
  // addresses a worsening trend beats one that addresses a static number.
  for (const t of computeTrendSignals(metrics).slice(0, 3)) {
    out.push({ signal: `trend_${t.signal}`, evidence: t.evidence });
  }
  for (const a of detectAnomalies(metrics).slice(0, 3)) {
    out.push({ signal: `anomaly_${a.metric}`, evidence: a.evidence });
  }

  // Routing hygiene: labels in real use, and how much work arrives ownerless —
  // both are what triage automations key off.
  const supabase = createServiceClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("assignee_id, space_id, priority, labels, created_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .gte("created_at", daysAgo(60))
    .limit(1000);
  if (tasks && tasks.length > 0) {
    const unassigned = tasks.filter((t) => !t.assignee_id).length;
    if (unassigned > 0) {
      out.push({
        signal: "unassigned_intake",
        evidence: `${unassigned} of the last ${tasks.length} tasks (${pct(unassigned, tasks.length)}%) were created with no assignee`,
      });
    }
    const noTeam = tasks.filter((t) => !t.space_id).length;
    if (noTeam > 0) {
      out.push({
        signal: "unrouted_intake",
        evidence: `${noTeam} recent tasks have no team assigned`,
      });
    }
    const labelRows = tasks.flatMap((t) =>
      Array.isArray(t.labels) ? (t.labels as string[]).map((l) => ({ l })) : [],
    );
    const labels = topCounts(labelRows, (r) => r.l, 5);
    if (labels.length > 0) {
      out.push({
        signal: "active_labels",
        evidence: `Labels in active use: ${labels.map(([l, c]) => `${l} (${c})`).join(", ")}`,
      });
    }
  }
  return out;
}

async function docsSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, space_id, updated_at, created_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (!docs?.length) return out;

  out.push({ signal: "doc_count", evidence: `${docs.length} active documents` });

  const stale = docs.filter((d) => d.updated_at && d.updated_at < daysAgo(90));
  if (stale.length > 0) {
    out.push({
      signal: "stale_docs",
      evidence: `${stale.length} documents haven't been edited in 90+ days (e.g. "${stale[0].title ?? "Untitled"}")`,
    });
  }
  const untitled = docs.filter(
    (d) => !d.title?.trim() || /^untitled/i.test(d.title.trim()),
  ).length;
  if (untitled > 0) {
    out.push({
      signal: "untitled_docs",
      evidence: `${untitled} documents are still called "Untitled"`,
    });
  }
  const unfiled = docs.filter((d) => !d.space_id).length;
  if (unfiled > 0) {
    out.push({
      signal: "unfiled_docs",
      evidence: `${unfiled} documents aren't attached to any team`,
    });
  }
  const recent = docs.filter((d) => d.created_at && d.created_at > daysAgo(30)).length;
  out.push({
    signal: "doc_creation_rate",
    evidence: `${recent} documents created in the last 30 days`,
  });
  // Titles tell the suggester what KIND of docs this property keeps (SOPs,
  // handovers, checklists) — that shapes what's worth automating.
  const titles = docs
    .map((d) => d.title?.trim())
    .filter((t): t is string => Boolean(t) && !/^untitled/i.test(t!))
    .slice(0, 12);
  if (titles.length > 0) {
    out.push({
      signal: "doc_titles",
      evidence: `Recent document titles: ${titles.join(" · ")}`,
    });
  }
  return out;
}

async function chatSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  // Channel *names* come from the spaces/deployments we own in Postgres —
  // deliberately NOT a Stream query. Message content is out of scope here:
  // it's expensive, and the suggester doesn't need to read chatter to know
  // which channels exist and what they're for.
  const [spacesRes, deploymentsRes] = await Promise.all([
    supabase
      .from("spaces")
      .select("name")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .limit(20),
    supabase
      .from("chatbot_channel_deployments")
      .select("channel_id")
      .eq("property_id", propertyId)
      .limit(20),
  ]);
  const teams = (spacesRes.data ?? []).map((s) => s.name);
  if (teams.length > 0) {
    out.push({
      signal: "team_channels",
      evidence: `Teams with channels: ${teams.join(", ")}`,
    });
  }
  const deployed = deploymentsRes.data?.length ?? 0;
  if (deployed > 0) {
    out.push({
      signal: "channel_bots",
      evidence: `${deployed} channel${deployed === 1 ? " has" : "s have"} a custom chatbot deployed`,
    });
  }
  return out;
}

async function meetingsSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  // Summaries live in a joined table, not a column on `meetings` — an empty
  // `meeting_summaries` array is what "never summarized" looks like.
  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, started_at, meeting_summaries(action_items)")
    .eq("property_id", propertyId)
    .gte("started_at", daysAgo(60))
    .limit(200);
  if (!meetings?.length) return out;
  out.push({
    signal: "meeting_volume",
    evidence: `${meetings.length} meetings in the last 60 days`,
  });
  const summaries = meetings.map((m) =>
    Array.isArray(m.meeting_summaries) ? m.meeting_summaries : [],
  );
  const unsummarized = summaries.filter((s) => s.length === 0).length;
  if (unsummarized > 0) {
    out.push({
      signal: "unsummarized_meetings",
      evidence: `${unsummarized} of those meetings have no summary yet`,
    });
  }
  const actionItems = summaries
    .flat()
    .reduce(
      (n, s) => n + (Array.isArray(s.action_items) ? s.action_items.length : 0),
      0,
    );
  if (actionItems > 0) {
    out.push({
      signal: "meeting_action_items",
      evidence: `${actionItems} action items were captured across those meeting summaries`,
    });
  }
  return out;
}

async function calendarSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const { data: events } = await supabase
    .from("calendar_events")
    .select("id, title, start_at")
    .eq("property_id", propertyId)
    .gte("start_at", new Date().toISOString())
    .lte("start_at", daysAhead(14))
    .limit(200);
  if (events?.length) {
    out.push({
      signal: "upcoming_events",
      evidence: `${events.length} events scheduled in the next 14 days`,
    });
  }
  return out;
}

async function formsSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const { data: forms } = await supabase
    .from("forms")
    .select("id, title, status")
    .eq("property_id", propertyId)
    .limit(100);
  if (!forms?.length) return out;
  out.push({
    signal: "form_inventory",
    evidence: `${forms.length} forms: ${forms
      .slice(0, 8)
      .map((f) => `${f.title} (${f.status})`)
      .join(", ")}`,
  });
  const { data: responses } = await supabase
    .from("form_responses")
    .select("form_id")
    .in(
      "form_id",
      forms.map((f) => f.id),
    )
    .gte("created_at", daysAgo(30))
    .limit(1000);
  if (responses?.length) {
    const byForm = topCounts(responses, (r) => r.form_id, 3);
    const nameOf = (id: string) => forms.find((f) => f.id === id)?.title ?? "a form";
    out.push({
      signal: "form_volume",
      evidence: `${responses.length} submissions in 30 days, busiest: ${byForm
        .map(([id, c]) => `${nameOf(id)} (${c})`)
        .join(", ")}`,
    });
  }
  return out;
}

async function bookingsSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const [servicesRes, bookingsRes] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("id, name, kind, booking_mode")
      .eq("property_id", propertyId)
      .limit(50),
    supabase
      .from("bookings")
      .select("id, status, source, service_id, starts_at")
      .eq("property_id", propertyId)
      .gte("starts_at", daysAgo(30))
      .limit(1000),
  ]);
  const services = servicesRes.data ?? [];
  if (services.length > 0) {
    out.push({
      signal: "service_inventory",
      evidence: `${services.length} bookable services: ${services
        .slice(0, 8)
        .map((s) => `${s.name} (${s.kind})`)
        .join(", ")}`,
    });
  }
  const bookings = bookingsRes.data ?? [];
  if (bookings.length > 0) {
    out.push({
      signal: "booking_volume",
      evidence: `${bookings.length} bookings in the last 30 days`,
    });
    for (const [status, count] of topCounts(bookings, (b) => b.status, 6)) {
      out.push({
        signal: `booking_status_${status}`,
        evidence: `${count} are ${status} (${pct(count, bookings.length)}%)`,
      });
    }
    const pending = bookings.filter((b) => b.status === "pending").length;
    if (pending > 0) {
      out.push({
        signal: "pending_backlog",
        evidence: `${pending} bookings are waiting on staff approval`,
      });
    }
    for (const [source, count] of topCounts(bookings, (b) => b.source, 3)) {
      out.push({
        signal: `booking_source_${source}`,
        evidence: `${count} came from ${source}`,
      });
    }
  }
  return out;
}

async function chatbotsSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const { data: bots } = await supabase
    .from("chatbots")
    .select("id, name, status")
    .eq("property_id", propertyId)
    .limit(50);
  if (!bots?.length) return out;
  out.push({
    signal: "bot_inventory",
    evidence: `${bots.length} chatbots: ${bots.map((b) => `${b.name} (${b.status})`).join(", ")}`,
  });
  const { data: convos } = await supabase
    .from("chatbot_conversations")
    .select("id, outcome, topic, sentiment")
    .in(
      "chatbot_id",
      bots.map((b) => b.id),
    )
    .gte("created_at", daysAgo(30))
    .limit(1000);
  if (convos?.length) {
    out.push({
      signal: "guest_volume",
      evidence: `${convos.length} guest conversations in 30 days`,
    });
    for (const [outcome, count] of topCounts(convos, (c) => c.outcome, 4)) {
      out.push({
        signal: `guest_outcome_${outcome}`,
        evidence: `${count} ended in "${outcome}"`,
      });
    }
    const negative = convos.filter((c) => c.sentiment === "negative").length;
    if (negative > 0) {
      out.push({
        signal: "negative_sentiment",
        evidence: `${negative} conversations were classified negative (${pct(negative, convos.length)}%)`,
      });
    }
    const topics = topCounts(convos, (c) => c.topic, 5);
    if (topics.length > 0) {
      out.push({
        signal: "guest_topics",
        evidence: `Top guest topics: ${topics.map(([t, c]) => `${t} (${c})`).join(", ")}`,
      });
    }
  }
  return out;
}

async function entitiesSignals(propertyId: string): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const supabase = createServiceClient();
  const { data: types } = await supabase
    .from("entity_types")
    .select("name, display_name")
    .eq("property_id", propertyId)
    .limit(30);
  if (types?.length) {
    out.push({
      signal: "entity_types",
      evidence: `Custom record types: ${types.map((t) => t.display_name || t.name).join(", ")}`,
    });
  }
  return out;
}

const GATHERS: Record<AutomationFeature, (propertyId: string) => Promise<RawSignal[]>> = {
  tasks: tasksSignals,
  docs: docsSignals,
  chat: chatSignals,
  meetings: meetingsSignals,
  calendar: calendarSignals,
  forms: formsSignals,
  bookings: bookingsSignals,
  chatbots: chatbotsSignals,
  entities: entitiesSignals,
};

/**
 * Gather this feature's signals, plus a little cross-feature context — an
 * automation that starts in Chat usually ENDS in Tasks, so the suggester needs
 * to know what the neighbouring surfaces look like too. We add a trimmed set
 * from the two features most automations pair with.
 */
export async function gatherFeatureSignals(
  propertyId: string,
  feature: AutomationFeature,
): Promise<SuggestionSignal[]> {
  const companions: AutomationFeature[] =
    feature === "tasks" ? ["chat"] : feature === "chat" ? ["tasks"] : ["tasks", "chat"];

  const [primary, ...rest] = await Promise.all([
    safe(() => GATHERS[feature](propertyId)),
    ...companions.map((c) => safe(() => GATHERS[c](propertyId))),
  ]);

  // Primary signals lead and are never crowded out; companions fill what's
  // left of the budget so the prompt stays small and the feature stays the
  // subject of every suggestion.
  const merged = [...primary, ...rest.flat().slice(0, 5)].slice(0, MAX_SIGNALS);
  return merged
    .filter((s) => s.evidence.trim().length > 0)
    .map((s, i) => ({ id: `s${i + 1}`, ...s }));
}

/** One gather failing must not take the whole modal down. */
async function safe(fn: () => Promise<RawSignal[]>): Promise<RawSignal[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[workflow-suggestions] signal gather failed", err);
    return [];
  }
}

/** Stable digest — the cache regenerates when the SITUATION changes. */
export function signalsDigest(signals: SuggestionSignal[]): string {
  return signals.map((s) => `${s.signal}=${s.evidence}`).join("|");
}
