/**
 * Pure half of the triage queue (migration 0111) — no I/O, so the server
 * module (`triage-queue.ts`), the client view, and the tests share one
 * definition of "where did this come from", "what does Accept pre-fill",
 * and "which row is next".
 */

import type { RecordSource, TaskPriority } from "@/lib/db/types";

export type TriageSuggestionField = "space" | "assignee" | "priority";

export type TriageIntakeKind = "guest" | "ai" | "workflow" | "person";

export type TriageIntake = {
  kind: TriageIntakeKind;
  /** Human label for the list row ("Front desk bot · Ana"). */
  label: string;
};

/**
 * Where a queued task came from. Guest chatbot tickets are recognised by
 * their `chatbot.order_created` event (the deterministic record the ticket
 * tool writes), not by `source` alone — eve and workflow writes are `ai` /
 * `workflow` too, and only the event says a GUEST was behind it.
 */
export function describeIntake(args: {
  source: RecordSource | string | null;
  creatorName: string | null;
  guestTicket: { chatbotName: string | null; guestName: string | null } | null;
}): TriageIntake {
  if (args.guestTicket) {
    const parts = [
      args.guestTicket.chatbotName ?? "Guest chatbot",
      args.guestTicket.guestName,
    ].filter(Boolean);
    return { kind: "guest", label: parts.join(" · ") };
  }
  if (args.source === "workflow") return { kind: "workflow", label: "Workflow" };
  if (args.source === "ai") return { kind: "ai", label: "AI" };
  return { kind: "person", label: args.creatorName ?? "Teammate" };
}

export type TriageFieldValues = {
  spaceId: string | null;
  assigneeId: string | null;
  priority: TaskPriority;
  projectId: string | null;
};

/**
 * What the Accept popover starts with: the task's own value wins (a person
 * or the intake already chose it); an EMPTY field takes the pending AI
 * suggestion, so "accept as suggested" is one keystroke.
 */
export function acceptDefaults(
  task: {
    space_id: string | null;
    assignee_id: string | null;
    priority: TaskPriority;
    project_id: string | null;
  },
  suggestions: { field: TriageSuggestionField; suggested_value: string; status: string }[],
): TriageFieldValues {
  const pending = (field: TriageSuggestionField) =>
    suggestions.find((s) => s.field === field && s.status === "pending")
      ?.suggested_value ?? null;
  return {
    spaceId: task.space_id ?? pending("space"),
    assigneeId: task.assignee_id ?? pending("assignee"),
    priority:
      task.priority !== "none"
        ? task.priority
        : ((pending("priority") as TaskPriority | null) ?? "none"),
    projectId: task.project_id,
  };
}

/**
 * Closing out a triage decision resolves the task's pending AI suggestions
 * too: a suggestion whose value the person ended up choosing counts as
 * accepted, anything else as dismissed — so the trust ladder's acceptance
 * stats (`triage-dial.tsx`) learn from triage, not only from the chips.
 * A decline passes `final = null`: every pending suggestion is dismissed.
 */
export function suggestionOutcomes(
  suggestions: { id: string; field: TriageSuggestionField; suggested_value: string }[],
  final: { space_id: string | null; assignee_id: string | null; priority: string } | null,
): { id: string; status: "accepted" | "dismissed" }[] {
  return suggestions.map((s) => {
    if (!final) return { id: s.id, status: "dismissed" as const };
    const chosen =
      s.field === "space"
        ? final.space_id
        : s.field === "assignee"
          ? final.assignee_id
          : final.priority;
    return {
      id: s.id,
      status: chosen === s.suggested_value ? ("accepted" as const) : ("dismissed" as const),
    };
  });
}

/**
 * After an item leaves the queue, select the one that took its place (the
 * next row), else the new last row, else nothing. `ids` is the list BEFORE
 * removal, in display order.
 */
export function nextTriageSelection(ids: string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  const rest = ids.filter((id) => id !== removedId);
  if (rest.length === 0) return null;
  if (index === -1) return rest[0];
  return rest[Math.min(index, rest.length - 1)];
}

/** Compact age for list rows: "now", "12m", "3h", "4d", "2w", "5mo". */
export function triageAge(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
