"use client";

import { useMemo } from "react";
import { RegisterAiKnowledge } from "@liveblocks/react";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { PropertyMember } from "@/lib/query/section-queries";

/**
 * Pours the current calendar context into the copilot so it can answer
 * questions about *this* week without the user having to repeat
 * everything. The trick from the Liveblocks example: register knowledge
 * as small, well-described JSON blobs — the model reads them like a
 * mini-RAG. Each blob's `description` is what the model uses to decide
 * whether to consult it.
 *
 * Knowledge re-registers every time `value` changes (React Query
 * invalidations, focus-date shifts), so the copilot always sees fresh
 * state without per-message context plumbing.
 *
 * We deliberately keep tool *result* / behavioural rules in the
 * `instructions` block and event content in the `events` block — the
 * model gets the most leverage when each blob has one job.
 */
export function CalendarAiKnowledge({
  propertyId,
  events,
  members,
  focusDate,
}: {
  propertyId: string;
  events: CalendarEvent[];
  members: PropertyMember[];
  focusDate: Date;
}) {
  // Strip the bulk we don't need the AI to see (full ISO timestamps,
  // colour hex, attendees with avatar URLs) and rename to natural
  // language fields the model can quote back at the user.
  const trimmedEvents = useMemo(() => {
    return events.slice(0, 100).map((e) => {
      if (e.source === "meeting") {
        return {
          id: e.id,
          kind: "meeting" as const,
          title: e.title,
          start: e.start,
          end: e.end,
          location: e.location,
          attendees: e.attendees.map((a) => a.user_id),
          allDay: e.all_day,
        };
      }
      if (e.source === "task") {
        return {
          id: e.id,
          kind: "task" as const,
          title: e.title,
          start: e.start,
          end: e.end,
          status: e.status,
          priority: e.priority,
        };
      }
      if (e.source === "booking") {
        return {
          id: e.id,
          kind: "booking" as const,
          title: e.title,
          start: e.start,
          end: e.end,
          guest: e.guest_name,
          party_size: e.party_size,
          status: e.booking_status,
        };
      }
      return {
        id: e.id,
        kind: "external" as const,
        title: e.title,
        start: e.start,
        end: e.end,
        provider: e.provider,
        busy: e.busy_status,
      };
    });
  }, [events]);

  const trimmedMembers = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.name ?? "Unnamed",
        role: m.role,
      })),
    [members],
  );

  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return (
    <>
      <RegisterAiKnowledge
        description="How to behave when working with the calendar"
        value={`You are a calendar assistant inside a property-management app called HotelClaw. Be concise — one sentence answers when possible.

When creating or editing events, always pass ISO 8601 timestamps in the user's timezone (${tz}). Prefer 30-min default durations unless the user says otherwise.

For task-scheduling, use the schedule-task tool — don't create a new meeting for an existing task.

For attendees: match by name against the members list. If no match, ask the user.

For "find free time" questions, call find-free-slot rather than guessing from the events list — it knows everyone's external (Google/Outlook) calendars too.

Never invent event ids. Only edit/delete events whose ids appear in the current-events knowledge blob. If the user references an event you can't find, say so.

After a successful tool call, summarise the change in one short sentence — don't repeat the parameters back verbatim.`}
      />
      <RegisterAiKnowledge
        description="The current date and timezone — use this whenever you need 'today', 'tomorrow', or any relative date"
        value={`Current local time: ${new Date().toISOString()}. Timezone: ${tz}. The user is currently focused on ${focusDate.toDateString()} in the calendar grid.`}
      />
      <RegisterAiKnowledge
        description="The property id this calendar belongs to — pass this as propertyId to every tool"
        value={propertyId}
      />
      <RegisterAiKnowledge
        description="Members of this property — match names from the user's message to ids in this list when adding attendees or assigning tasks"
        value={JSON.stringify(trimmedMembers)}
      />
      <RegisterAiKnowledge
        description="Events visible in the current calendar window — meetings, scheduled tasks, and external (Google/Outlook) events"
        value={JSON.stringify(trimmedEvents)}
      />
    </>
  );
}
