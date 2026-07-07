"use client";

import { useQueryClient } from "@tanstack/react-query";
import { defineAiTool } from "@liveblocks/client";
import { RegisterAiTool } from "@liveblocks/react";
import { AiTool } from "@liveblocks/react-ui";
import { toast } from "sonner";
import {
  saveMeeting,
  deleteMeeting,
  scheduleTask,
} from "@/lib/calendar/actions";

/**
 * Tools the AI can call. Each tool is a thin wrapper around an existing
 * server action — `saveMeeting`, `deleteMeeting`, `scheduleTask` — so
 * the AI path goes through the exact same code as the manual UI path.
 * RLS, attendee dedupe, recurrence handling all flow through one place.
 *
 * Pattern, from the Liveblocks AI calendar example:
 *   * Destructive tools (create / edit / delete) wrap the execute call in
 *     `<AiTool.Confirmation>` — the user clicks a confirm button before
 *     the action commits.
 *   * Read-only tools (find-free-slot) just render `<AiTool>` and let the
 *     model summarise the result in chat.
 *
 * `broadcastInvalidate` is wired in from the calendar room so peers'
 * grids refresh on the same Liveblocks event the manual dialog uses.
 */
export function CalendarAiTools({
  propertyId,
  currentUserId,
  broadcastInvalidate,
}: {
  propertyId: string;
  currentUserId: string;
  broadcastInvalidate: () => void;
}) {
  const qc = useQueryClient();

  function afterMutation() {
    qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    broadcastInvalidate();
  }

  return (
    <>
      {/* ---------- create-meeting ---------- */}
      <RegisterAiTool
        name="create-meeting"
        tool={defineAiTool()({
          description:
            "Create a new meeting on the calendar. Use this when the user asks to schedule, book, or set up an event. Attendees are matched by user id against the members list — never invent ids.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event title" },
              start: {
                type: "string",
                description: "ISO 8601 start timestamp",
              },
              end: {
                type: "string",
                description: "ISO 8601 end timestamp",
              },
              attendeeIds: {
                type: "array",
                items: { type: "string" },
                description:
                  "User ids from the members list. The current user is always added automatically.",
              },
              location: { type: "string" },
              description: { type: "string" },
              allDay: { type: "boolean" },
              withVideoCall: {
                type: "boolean",
                description:
                  "Attach a Stream Video call to this meeting. Default true unless the user explicitly says 'no video' / 'in-person'.",
              },
            },
            required: ["title", "start", "end"],
            additionalProperties: false,
          },
          render: ({ stage, args, types }) => {
            if (stage === "receiving") return "Drafting meeting…";
            return (
              <AiTool title={`Create meeting: ${args.title}`} icon="📅">
                <AiTool.Confirmation
                  types={types}
                  confirm={async (input) => {
                    const result = await saveMeeting({
                      propertyId,
                      title: input.title,
                      start: input.start,
                      end: input.end,
                      allDay: input.allDay ?? false,
                      attendeeIds: (input.attendeeIds ?? []).filter(
                        (id) => id !== currentUserId,
                      ),
                      description: input.description,
                      location: input.location,
                      withVideoCall: input.withVideoCall ?? true,
                      recurrence: null,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return {
                        data: { ok: false, error: result.error },
                        description: `Failed: ${result.error}`,
                      };
                    }
                    afterMutation();
                    return {
                      data: { ok: true, meetingId: result.meetingId },
                      description: `Created "${input.title}"`,
                    };
                  }}
                >
                  Create &quot;{args.title}&quot;
                  {args.start ? ` on ${formatWhen(args.start)}` : ""}?
                </AiTool.Confirmation>
              </AiTool>
            );
          },
        })}
      />

      {/* ---------- edit-meeting ---------- */}
      <RegisterAiTool
        name="edit-meeting"
        tool={defineAiTool()({
          description:
            "Update an existing meeting. Use the meeting id from the current-events knowledge blob. For recurring occurrences (id like '<uuid>@<iso>'), strip the '@…' suffix before passing — the underlying series is what gets updated.",
          parameters: {
            type: "object",
            properties: {
              meetingId: { type: "string" },
              title: { type: "string" },
              start: { type: "string" },
              end: { type: "string" },
              attendeeIds: {
                type: "array",
                items: { type: "string" },
              },
              location: { type: "string" },
              description: { type: "string" },
              allDay: { type: "boolean" },
            },
            required: ["meetingId", "title", "start", "end"],
            additionalProperties: false,
          },
          render: ({ stage, args, types }) => {
            if (stage === "receiving") return "Drafting changes…";
            return (
              <AiTool title={`Update: ${args.title}`} icon="✏️">
                <AiTool.Confirmation
                  types={types}
                  confirm={async (input) => {
                    const baseId = input.meetingId.split("@")[0];
                    const result = await saveMeeting({
                      propertyId,
                      meetingId: baseId,
                      title: input.title,
                      start: input.start,
                      end: input.end,
                      allDay: input.allDay ?? false,
                      attendeeIds: (input.attendeeIds ?? []).filter(
                        (id) => id !== currentUserId,
                      ),
                      description: input.description,
                      location: input.location,
                      withVideoCall: true,
                      recurrence: null,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return {
                        data: { ok: false, error: result.error },
                        description: `Failed: ${result.error}`,
                      };
                    }
                    afterMutation();
                    return {
                      data: { ok: true },
                      description: `Updated "${input.title}"`,
                    };
                  }}
                >
                  Update this meeting?
                </AiTool.Confirmation>
              </AiTool>
            );
          },
        })}
      />

      {/* ---------- delete-meeting ---------- */}
      <RegisterAiTool
        name="delete-meeting"
        tool={defineAiTool()({
          description: "Delete a meeting by id. Recurring occurrences delete the whole series.",
          parameters: {
            type: "object",
            properties: {
              meetingId: { type: "string" },
            },
            required: ["meetingId"],
            additionalProperties: false,
          },
          render: ({ stage, args, types }) => {
            if (stage === "receiving") return "…";
            return (
              <AiTool title="Delete meeting" icon="🗑️">
                <AiTool.Confirmation
                  types={types}
                  confirm={async (input) => {
                    const baseId = input.meetingId.split("@")[0];
                    const result = await deleteMeeting(propertyId, baseId);
                    if ("error" in result) {
                      return {
                        data: { ok: false, error: result.error },
                        description: `Failed: ${result.error}`,
                      };
                    }
                    afterMutation();
                    return {
                      data: { ok: true },
                      description: "Deleted",
                    };
                  }}
                >
                  Permanently delete this meeting? Attendees will be
                  notified.
                </AiTool.Confirmation>
              </AiTool>
            );
          },
        })}
      />

      {/* ---------- schedule-task ---------- */}
      <RegisterAiTool
        name="schedule-task"
        tool={defineAiTool()({
          description:
            "Block out time on the calendar for an existing task. Use task ids from the current-events knowledge blob (kind: 'task'). Does NOT create a meeting — only sets scheduled_start/end on the task.",
          parameters: {
            type: "object",
            properties: {
              taskId: { type: "string" },
              start: { type: "string" },
              end: { type: "string" },
            },
            required: ["taskId", "start", "end"],
            additionalProperties: false,
          },
          render: ({ stage, args, types }) => {
            if (stage === "receiving") return "…";
            return (
              <AiTool title="Schedule task" icon="🧱">
                <AiTool.Confirmation
                  types={types}
                  confirm={async (input) => {
                    const result = await scheduleTask({
                      propertyId,
                      taskId: input.taskId,
                      start: input.start,
                      end: input.end,
                    });
                    if ("error" in result) {
                      return {
                        data: { ok: false, error: result.error },
                        description: `Failed: ${result.error}`,
                      };
                    }
                    afterMutation();
                    return {
                      data: { ok: true },
                      description: `Scheduled for ${formatWhen(input.start)}`,
                    };
                  }}
                >
                  Block this task on the calendar from{" "}
                  {formatWhen(args.start)} to {formatWhen(args.end)}?
                </AiTool.Confirmation>
              </AiTool>
            );
          },
        })}
      />

      {/* ---------- find-free-slot (read-only) ---------- */}
      <RegisterAiTool
        name="find-free-slot"
        tool={defineAiTool()({
          description:
            "Find one or more free time windows for a set of users inside a date range. Calls the free/busy aggregator so it respects external Google/Outlook calendars too. Returns at most `limit` suggestions.",
          parameters: {
            type: "object",
            properties: {
              userIds: {
                type: "array",
                items: { type: "string" },
                description: "User ids that should all be free.",
              },
              from: { type: "string", description: "ISO range start" },
              to: { type: "string", description: "ISO range end" },
              durationMinutes: {
                type: "number",
                description: "Required slot duration (default 30).",
              },
              limit: {
                type: "number",
                description: "Max number of suggestions (default 3).",
              },
            },
            required: ["userIds", "from", "to"],
            additionalProperties: false,
          },
          execute: async (input) => {
            const params = new URLSearchParams({
              users: input.userIds.join(","),
              from: input.from,
              to: input.to,
            });
            const res = await fetch(
              `/api/properties/${propertyId}/calendar/free-busy?${params}`,
            );
            if (!res.ok) {
              return { data: { error: await res.text() } };
            }
            const busy = (await res.json()) as Array<{
              user_id: string;
              start_at: string;
              end_at: string;
              busy: string;
            }>;
            const duration =
              (input.durationMinutes ?? 30) * 60_000;
            const limit = input.limit ?? 3;
            const suggestions = findFreeSlots(
              new Date(input.from),
              new Date(input.to),
              busy.map((b) => ({
                start: new Date(b.start_at),
                end: new Date(b.end_at),
              })),
              duration,
              limit,
            );
            return {
              data: {
                suggestions: suggestions.map((s) => ({
                  start: s.start.toISOString(),
                  end: s.end.toISOString(),
                })),
              },
            };
          },
          render: ({ stage, result }) => {
            if (stage !== "executed") return <AiTool title="Searching…" />;
            const data = result?.data as
              | { suggestions: Array<{ start: string; end: string }> }
              | { error: string }
              | undefined;
            if (!data || "error" in (data as object)) {
              return <AiTool title="Couldn't find free time" icon="⚠️" />;
            }
            const suggestions =
              (data as { suggestions: Array<{ start: string; end: string }> })
                .suggestions ?? [];
            return (
              <AiTool
                title={
                  suggestions.length === 0
                    ? "No free time in that range"
                    : `Found ${suggestions.length} option${suggestions.length === 1 ? "" : "s"}`
                }
                icon="🕓"
              />
            );
          },
        })}
      />
    </>
  );
}

/** Hour-aware "Aug 4 at 2:00 PM" for the confirmation prompts. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} at ${d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Greedy free-slot finder: walks the union of every user's busy ranges,
 * coalesces overlaps, then yields windows of >= `durationMs` between
 * them. Restricted to 8am–7pm local time so we don't suggest midnight
 * meetings.
 */
function findFreeSlots(
  rangeStart: Date,
  rangeEnd: Date,
  busy: Array<{ start: Date; end: Date }>,
  durationMs: number,
  limit: number,
): Array<{ start: Date; end: Date }> {
  // Sort + merge.
  const sorted = [...busy].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: typeof sorted = [];
  for (const slot of sorted) {
    const tail = merged[merged.length - 1];
    if (tail && slot.start <= tail.end) {
      if (slot.end > tail.end) tail.end = slot.end;
    } else {
      merged.push({ start: new Date(slot.start), end: new Date(slot.end) });
    }
  }

  const out: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(rangeStart);
  for (const b of [...merged, { start: rangeEnd, end: rangeEnd }]) {
    while (
      cursor.getTime() + durationMs <= b.start.getTime() &&
      out.length < limit
    ) {
      const slotStart = clampToBusinessHours(cursor);
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      if (slotEnd <= b.start && isBusinessHour(slotStart) && isBusinessHour(slotEnd)) {
        out.push({ start: slotStart, end: slotEnd });
      }
      cursor = new Date(cursor.getTime() + 30 * 60_000);
    }
    if (b.end > cursor) cursor = new Date(b.end);
    if (out.length >= limit) break;
  }
  return out;
}

function isBusinessHour(d: Date): boolean {
  const h = d.getHours();
  return h >= 8 && h < 19;
}

function clampToBusinessHours(d: Date): Date {
  const out = new Date(d);
  if (out.getHours() < 8) out.setHours(8, 0, 0, 0);
  return out;
}
