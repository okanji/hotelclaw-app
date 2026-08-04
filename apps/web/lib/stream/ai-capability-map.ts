/**
 * What the in-channel bot can actually DO — the capability blurb the
 * auto-mode classifier reasons against, plus the tool ids each line covers.
 *
 * Why this file exists: auto mode's rule B ("the message asks for something
 * on the capability list") is one of only two ALWAYS-respond rules, so the
 * blurb is load-bearing — anything missing from it is a thing the bot can do
 * but will stay silent about unless someone @-mentions it. The list drifted
 * badly once already: it still described a read-only bot (tasks, documents,
 * meetings, org chart) long after the channel bot gained bookings, forms,
 * meetings scheduling, spreadsheets, workflows, notifications and the whole
 * write surface — 47 grants against 5 advertised abilities.
 *
 * `CAPABILITY_TOOL_COVERAGE` is the machine-checkable half of that fix: a
 * drift guard (lib/agents/__tests__/agent-runtime-sync.test.ts) asserts every
 * tool the channel bot is granted appears under some line here, so adding a
 * grant without teaching the classifier about it fails the test instead of
 * quietly making auto mode dumber.
 *
 * Deliberately dependency-free (no "server-only", no AI SDK) so the guard can
 * import it without pulling the model stack into vitest.
 */

/**
 * Capability line → the catalog tool ids it advertises. Keys are prose
 * fragments only for readability; nothing reads them but humans.
 */
export const CAPABILITY_TOOL_COVERAGE: Record<string, readonly string[]> = {
  "tasks & projects": [
    "list_open_tasks",
    "search_tasks",
    "create_task",
    "update_task",
    "delete_task",
    "escalate_task",
    "create_project",
  ],
  "documents & spreadsheets": [
    "search_documents",
    "list_documents",
    "read_document",
    "create_document",
    "update_document",
    "rename_document",
    "archive_document",
    "restore_document_revision",
    "read_sheet",
    "update_sheet_cells",
  ],
  meetings: [
    "list_meetings",
    "list_upcoming_meetings",
    "schedule_meeting",
    "update_meeting",
    "cancel_meeting",
  ],
  bookings: [
    "list_bookings",
    "list_today_bookings",
    "create_booking",
    "update_booking_status",
  ],
  forms: [
    "list_forms",
    "get_form_response_summaries",
    "create_form",
    "set_form_status",
    "share_form_to_channel",
  ],
  "people & comms": [
    "get_org_chart",
    "search_chat_messages",
    "send_notification",
    "post_to_channel",
  ],
  "workflows & reports": [
    "list_workflows",
    "trigger_workflow",
    "get_insight_brief",
    "get_weekly_report",
    "list_handovers",
    "guest_conversation_insights",
  ],
  "knowledge & background work": [
    "brain_search",
    "brain_think",
    "brain_get",
    "brain_list",
    "brain_capture",
    "read_resource",
    "start_background_job",
  ],
};

/**
 * The blurb itself. Grouped by domain rather than enumerated tool-by-tool:
 * the classifier needs to recognise "is this in the bot's world?", and a
 * 47-line tool dump costs tokens on every message without helping that call.
 */
export function botCapabilityBlurb(botName: string): string {
  return [
    `What ${botName} can actually DO in this property (via tools) — the list rule B is judged against:`,
    "  • Tasks & projects — find or search tasks (including finished ones), see what's open, blocked, overdue or unassigned; create, update, assign, re-prioritise, escalate or delete tasks; create projects.",
    "  • Documents & spreadsheets — search, list and read documents (SOPs, policies, notes); write, edit, rename and archive them; read and edit spreadsheet cells.",
    "  • Meetings — list past and upcoming meetings; schedule, reschedule or cancel one.",
    "  • Bookings — look up bookings for any window; take a booking, or change its status (confirm, cancel, seat/check-in, no-show).",
    "  • Forms — list forms and their response summaries; build a form, publish or close it, share it into a channel.",
    "  • People & comms — look up the org chart (who owns what, reporting lines, team leads), search this channel's history, notify someone, or post into another channel.",
    "  • Workflows & reports — list and trigger workflows; read the intelligence brief, weekly reports, handovers, and guest-chatbot activity.",
    "  • Knowledge & background work — search the property's knowledge brain, and kick off longer-running jobs that report back here.",
  ].join("\n");
}
