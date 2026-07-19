/**
 * Pod-bot tool catalog — the transparency + config vocabulary for the Fleet
 * UI. KEEP IN SYNC with apps/agent/agent/tools/pod-tools.ts (the runtime
 * truth): every tool the runtime can build must appear here, `gated` must
 * mirror `approval: always()`, and nothing here may claim a tool the
 * runtime doesn't implement. Same honesty contract as lib/agents/builtin.ts.
 */

export type PodToolInfo = {
  id: string;
  label: string;
  description: string;
  /** Mirrors approval: always() in pod-tools.ts — the runtime parks the
   * call for a human decision; the UI badges these. */
  gated: boolean;
  category: "Tasks" | "Bookings" | "Documents" | "Chat" | "Brain" | "Money";
};

export const POD_TOOL_CATALOG: PodToolInfo[] = [
  {
    id: "list_tasks",
    label: "List tasks",
    description: "Read the property's tasks (title, status, priority, due date).",
    gated: false,
    category: "Tasks",
  },
  {
    id: "create_task",
    label: "Create task",
    description: "Create a task in the property, attributed to the requesting teammate.",
    gated: false,
    category: "Tasks",
  },
  {
    id: "update_task",
    label: "Update task",
    description: "Change a task's status, priority, or due date.",
    gated: false,
    category: "Tasks",
  },
  {
    id: "get_bookings",
    label: "List bookings",
    description: "Read bookings in a date window (guest, party, status, service).",
    gated: false,
    category: "Bookings",
  },
  {
    id: "get_booking",
    label: "Look up booking",
    description: "Fetch one booking by its BKG-XXXXXX reference.",
    gated: false,
    category: "Bookings",
  },
  {
    id: "search_docs",
    label: "Search documents",
    description: "Full-text search over the property's documents.",
    gated: false,
    category: "Documents",
  },
  {
    id: "read_doc",
    label: "Read document",
    description: "Read a document's content by id.",
    gated: false,
    category: "Documents",
  },
  {
    id: "notify_channel",
    label: "Notify channel",
    description: "Post a message into a property chat channel as the bot.",
    gated: false,
    category: "Chat",
  },
  {
    id: "brain_query",
    label: "Query brain",
    description:
      "Hybrid search over the pod's knowledge brain (its own pages + federated master playbooks).",
    gated: false,
    category: "Brain",
  },
  {
    id: "brain_get",
    label: "Read brain page",
    description: "Fetch a single brain page by its slug.",
    gated: false,
    category: "Brain",
  },
  {
    id: "brain_write",
    label: "Write brain page",
    description:
      "Write/update a page in the pod's own brain source (never the master).",
    gated: false,
    category: "Brain",
  },
  {
    id: "refund_booking",
    label: "Refund booking",
    description: "Refund a booking. Parks for human approval before executing.",
    gated: true,
    category: "Money",
  },
  {
    id: "override_rate",
    label: "Override rate",
    description: "Override a rate for a stay. Parks for human approval before executing.",
    gated: true,
    category: "Money",
  },
  {
    id: "comp_night",
    label: "Comp a night",
    description: "Comp a night on a booking. Parks for human approval before executing.",
    gated: true,
    category: "Money",
  },
];

export const POD_TOOL_IDS = new Set(POD_TOOL_CATALOG.map((t) => t.id));

/** Display emoji per pod-bot slug (bots have no emoji column — the slug IS
 * the identity, mirrored in the brain's playbooks/<property>/<slug>.md). */
export function podBotEmoji(botSlug: string): string {
  const map: Record<string, string> = {
    frontdesk: "🛎️",
    bookings: "📅",
    housekeeping: "🧹",
    analyst: "📊",
  };
  return map[botSlug] ?? "🤖";
}

export function podToolInfo(id: string): PodToolInfo | null {
  return POD_TOOL_CATALOG.find((t) => t.id === id) ?? null;
}
