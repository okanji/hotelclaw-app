/**
 * The actions-MCP tool surface (app/api/actions-mcp/[transport]/route.ts).
 * Single source of truth for api_tokens.allowed_tools values — the route's
 * requireTool() literals and the Fleet UI's key-scope multi-select both
 * import from here so they cannot drift. KEEP IN SYNC with the server.tool()
 * registrations in that route.
 */

export const ACTIONS_MCP_TOOLS = [
  "list_tasks",
  "create_task",
  "get_bookings",
  "get_booking",
  "trigger_workflow",
  "get_workflow_status",
] as const;

export type ActionsMcpTool = (typeof ACTIONS_MCP_TOOLS)[number];

export const ACTIONS_MCP_TOOL_INFO: Record<
  ActionsMcpTool,
  { label: string; description: string; write: boolean }
> = {
  list_tasks: {
    label: "List tasks",
    description: "Read tasks in the key's property.",
    write: false,
  },
  create_task: {
    label: "Create task",
    description: "Create a task in the key's property.",
    write: true,
  },
  get_bookings: {
    label: "List bookings",
    description: "Read bookings in a date window.",
    write: false,
  },
  get_booking: {
    label: "Look up booking",
    description: "Fetch one booking by reference.",
    write: false,
  },
  trigger_workflow: {
    label: "Trigger workflow",
    description:
      "Start a named durable workflow (extend_stay, rebook_guest). Money-moving steps still park for human approval.",
    write: true,
  },
  get_workflow_status: {
    label: "Workflow status",
    description: "Read a workflow session's status and latest message.",
    write: false,
  },
};
