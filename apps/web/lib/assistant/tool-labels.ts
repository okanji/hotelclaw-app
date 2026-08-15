/**
 * Human labels for the assistant's tool calls.
 *
 * The transcript shows what the assistant DID, not what it called — "Searched
 * documents" rather than `search_documents`. The raw name and payload stay one
 * click away in the disclosure, which is the transparency half of the deal:
 * a personal assistant with this much reach has to be legible.
 *
 * Unmapped ids fall back to a de-underscored sentence case, so a newly granted
 * catalog tool reads acceptably before anyone touches this file.
 */

const LABELS: Record<string, string> = {
  // Tasks
  list_open_tasks: "Read open tasks",
  search_tasks: "Searched tasks",
  create_task: "Created a task",
  update_task: "Updated a task",
  delete_task: "Deleted a task",
  escalate_task: "Escalated a task",
  create_project: "Created a project",
  // Documents
  search_documents: "Searched documents",
  list_documents: "Listed documents",
  read_document: "Read a document",
  create_document: "Wrote a document",
  update_document: "Edited a document",
  rename_document: "Renamed a document",
  archive_document: "Archived a document",
  restore_document_revision: "Restored a revision",
  // Spreadsheets
  read_sheet: "Read a spreadsheet",
  update_sheet_cells: "Edited a spreadsheet",
  // Calendar + bookings
  list_meetings: "Checked the calendar",
  schedule_meeting: "Scheduled a meeting",
  update_meeting: "Updated a meeting",
  cancel_meeting: "Cancelled a meeting",
  list_bookings: "Checked bookings",
  create_booking: "Made a booking",
  update_booking_status: "Updated a booking",
  // Chat
  search_chat_messages: "Searched conversations",
  list_channels: "Listed channels",
  post_to_channel: "Posted to a channel",
  send_notification: "Sent a notification",
  // Forms + workflows
  list_forms: "Listed forms",
  get_form_response_summaries: "Read form responses",
  create_form: "Built a form",
  set_form_status: "Changed a form's status",
  share_form_to_channel: "Shared a form",
  list_workflows: "Listed workflows",
  trigger_workflow: "Ran a workflow",
  // Knowledge
  brain_search: "Searched the knowledge brain",
  brain_get: "Opened a brain page",
  brain_list: "Browsed the brain",
  brain_think: "Reasoned over the brain",
  brain_capture: "Captured knowledge",
  // Reports + org
  get_insight_brief: "Read the intelligence brief",
  get_weekly_report: "Read the weekly report",
  list_handovers: "Read handovers",
  guest_conversation_insights: "Reviewed guest conversations",
  get_org_chart: "Read the org chart",
  // Presentation
  render_ui: "Prepared a view",
};

export function toolLabel(toolName: string): string {
  const known = LABELS[toolName];
  if (known) return known;
  const words = toolName.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Tools whose whole point is the rendered card — their activity row would be
 * noise sitting directly above the thing it describes.
 */
export const SILENT_TOOLS = new Set(["render_ui"]);
